import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportHtml, exportLinkedDocument } from '../src/lib/adapters/html';
import {
  collectExcludedLinks,
  isLinkedDocument,
  LINKED_CONTRACT_VERSION
} from '../src/lib/portable/document';
import { loadDirectory, snapshotOf } from '../src/lib/server/models';
import { compose } from '../src/lib/composition/compose';
import { staticResolver } from '../src/lib/composition/snapshot';
import { snapshotsForResolver } from '../src/lib/portable/document';

const FIXTURES = resolve('tests/fixtures/linked-projects');
const dummyAssets = { js: '/* reader */', css: '/* css */', notices: 'licenses' };

async function hostPlugin(root: string) {
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  await cp(join(FIXTURES, 'third'), join(models, 'third'), { recursive: true });
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') },
        { id: 'third', directory: join(models, 'third') }
      ]
    })
  );
  const host = await loadDirectory(join(models, 'host'));
  const plugin = await loadDirectory(join(models, 'plugin'));
  return { models, catalog, host, plugin };
}

function embeddedDocument(html: string): unknown {
  const opened = html.indexOf('<script type="application/json" id="fractal-document">');
  const closed = html.indexOf('</script>', opened);
  assert.ok(opened >= 0 && closed > opened);
  const start = html.indexOf('>', opened) + 1;
  return JSON.parse(html.slice(start, closed));
}

test('collectExcludedLinks lists foreign targets outside the included set', () => {
  const excluded = collectExcludedLinks([
    {
      id: 'host',
      links: {
        version: 1,
        links: [
          {
            id: 'plugin',
            title: 'Beacon architecture',
            target: { model: 'plugin', scene: 'overview' }
          },
          { id: 'unavailable', title: 'Unregistered plugin', target: { model: 'missing-plugin' } }
        ],
        connections: [],
        compositions: []
      }
    },
    {
      id: 'plugin',
      links: {
        version: 1,
        links: [{ id: 'host', title: 'Host', target: { model: 'host' } }],
        connections: [],
        compositions: []
      }
    }
  ]);
  assert.deepEqual(
    excluded.map((entry) => ({
      owner: entry.owner,
      linkId: entry.linkId,
      target: entry.target.model
    })),
    [{ owner: 'host', linkId: 'unavailable', target: 'missing-plugin' }]
  );
});

test('single-model HTML export stays a v1 document without a linked contract', async () => {
  const { model, sequences } = await loadDirectory(resolve('examples/delivery'));
  const html = await exportHtml(model, {
    state: model.scenes[0],
    sequences,
    assets: dummyAssets
  });
  const document = embeddedDocument(html) as {
    version: number;
    model: { id: string };
    linkedContract?: number;
  };
  assert.equal(document.version, 1);
  assert.equal(document.model.id, 'delivery');
  assert.equal(document.linkedContract, undefined);
  assert.equal(isLinkedDocument(document as never), false);
  assert.doesNotMatch(html, /fractal-linked-contract/);
  assert.doesNotMatch(html, /fractal-linked-required/);
});

test('linked HTML export embeds snapshots, revisions and excluded links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-portable-linked-'));
  try {
    const { host, plugin } = await hostPlugin(root);
    const { document, html, report } = await exportLinkedDocument(host.model, {
      state: host.model.scenes[0],
      scene: 'overview',
      sequences: host.sequences,
      assets: dummyAssets,
      include: ['plugin'],
      snapshots: [snapshotOf(host), snapshotOf(plugin)],
      sequencesByModel: { host: host.sequences, plugin: plugin.sequences }
    });
    assert.equal(document.linkedContract, LINKED_CONTRACT_VERSION);
    assert.equal(document.readOnly, true);
    assert.deepEqual(
      document.snapshots.map((snapshot) => snapshot.id),
      ['host', 'plugin']
    );
    assert.ok(document.snapshots[0].links);
    assert.ok(document.snapshots[0].origins.elements.core);
    assert.equal(document.revisions.version, 1);
    assert.deepEqual(
      document.revisions.projects.map((entry) => entry.model),
      ['host', 'plugin']
    );
    assert.equal(document.excluded.length, 1);
    assert.equal(document.excluded[0].target.model, 'missing-plugin');
    assert.equal(document.excluded[0].reason, 'excluded');
    assert.ok(!('model' in document));
    assert.equal(report.linkedContract, 1);
    assert.deepEqual(
      report.included.map((entry) => entry.model),
      ['host', 'plugin']
    );
    assert.match(html, /name="fractal-linked-contract" content="1"/);
    assert.match(html, /fractal-linked-required/);
    assert.doesNotMatch(html, /Relay plugin/);
    const parsed = embeddedDocument(html) as typeof document;
    assert.equal(parsed.linkedContract, 1);
    const again = await compose(
      staticResolver(snapshotsForResolver(parsed.snapshots)),
      parsed.composition
    );
    assert.equal(again.projects.length, 2);
    assert.equal(again.bridges.length, 2);
    assert.equal(
      again.stubs.some((stub) => stub.target.model === 'missing-plugin'),
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('linked HTML export requires snapshots for every included id', async () => {
  const host = await loadDirectory(join(FIXTURES, 'host'));
  await assert.rejects(
    () =>
      exportLinkedDocument(host.model, {
        state: host.model.scenes[0],
        assets: dummyAssets,
        include: ['plugin'],
        snapshots: [snapshotOf(host)]
      }),
    /missing snapshots for: plugin/
  );
});

test('export --help advertises --include for HTML', () => {
  const result = spawnSync(resolve('bin/fractal'), ['export', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--include ID,ID/);
  assert.match(result.stdout, /explicit linked set/);
});
