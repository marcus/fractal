import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { PngExportError, renderPng } from '../src/lib/adapters/png';
import { resetCompositionState } from '../src/lib/server/composition';
import { POST } from '../src/routes/api/export/+server';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>';
const FIXTURES = 'tests/fixtures/linked-projects';

function fractal(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  const result = spawnSync(resolve('bin/fractal'), args, {
    ...(cwd === undefined ? {} : { cwd }),
    encoding: 'utf8',
    env: { ...process.env, FRACTAL_CHROMIUM_PATH: '', ...env }
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const MODEL = resolve('examples/delivery');
const EXPORT = ['export', '--directory', MODEL, '--format', 'png'];

test('a missing browser is one short structured error, not the Playwright banner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-png-'));
  try {
    // An empty browsers path guarantees the default launch has nothing to start.
    const env = { PLAYWRIGHT_BROWSERS_PATH: join(root, 'no-browsers') };
    for (const args of [
      [...EXPORT, '--output', join(root, 'scene.png')],
      [
        'sequence-export',
        '--directory',
        MODEL,
        '--format',
        'png',
        '--output',
        join(root, 'seq.png')
      ]
    ]) {
      const result = fractal(args, env);
      assert.equal(result.status, 1, result.stdout);
      assert.equal(result.stderr.trim().split('\n').length, 1, 'a single line of JSON on stderr');
      const failure = JSON.parse(result.stderr);
      assert.equal(failure.error, 'png-export-needs-chromium');
      assert.equal(failure.fix, 'npx playwright install chromium-headless-shell');
      assert.match(failure.alternative, /FRACTAL_CHROMIUM_PATH/);
      assert.match(failure.alternative, /rsvg-convert -w 3840/);
      assert.doesNotMatch(result.stderr, /╔|Playwright Team|Executable doesn't exist/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an explicit browser path that does not exist is reported with that path', async () => {
  const missing = join(tmpdir(), 'fractal-no-such-chrome');
  await assert.rejects(renderPng(SVG, { chromiumPath: missing }), (error: unknown) => {
    assert.ok(error instanceof PngExportError);
    assert.equal(error.toJSON().error, 'png-export-chromium-not-found');
    assert.equal(error.toJSON().path, missing);
    return true;
  });
  // The environment variable is read at call time, and the CLI flag beats it.
  await assert.rejects(renderPng(SVG, { env: { FRACTAL_CHROMIUM_PATH: missing } }), PngExportError);
  const cli = fractal(
    [...EXPORT, '--chromium', missing, '--output', join(tmpdir(), 'unused.png')],
    {}
  );
  assert.equal(JSON.parse(cli.stderr).error, 'png-export-chromium-not-found');
  assert.equal(JSON.parse(cli.stderr).path, missing);
});

test('FRACTAL_CHROMIUM_PATH and --chromium launch the named executable', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fractal-png-')));
  try {
    // A stub that records its invocation and exits proves which executable was launched without a download.
    const stub = join(root, 'stub-chrome');
    const marker = join(root, 'launched');
    await writeFile(stub, `#!/bin/sh\necho "$0" >> "${marker}"\nexit 1\n`);
    await chmod(stub, 0o755);
    const env = { PLAYWRIGHT_BROWSERS_PATH: join(root, 'no-browsers') };

    const viaEnv = fractal([...EXPORT, '--output', join(root, 'a.png')], {
      ...env,
      FRACTAL_CHROMIUM_PATH: stub
    });
    assert.equal(viaEnv.status, 1);
    assert.equal((await readFile(marker, 'utf8')).trim(), stub);
    assert.notEqual(JSON.parse(viaEnv.stderr).error, 'png-export-needs-chromium');

    await rm(marker);
    const viaFlag = fractal([...EXPORT, '--chromium', stub, '--output', join(root, 'b.png')], env);
    assert.equal(viaFlag.status, 1);
    assert.equal((await readFile(marker, 'utf8')).trim(), stub);
    assert.notEqual(JSON.parse(viaFlag.stderr).error, 'png-export-needs-chromium');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an existing Chromium renders a PNG when Playwright has no browser of its own', async (t) => {
  const executable = chromium.executablePath();
  if (!existsSync(executable)) return t.skip('no full Chromium installed to borrow');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fractal-png-')));
  try {
    const result = fractal(
      [...EXPORT, '--output', 'borrowed.png'],
      { PLAYWRIGHT_BROWSERS_PATH: join(root, 'no-browsers'), FRACTAL_CHROMIUM_PATH: executable },
      root
    );
    assert.equal(result.status, 0, result.stderr);
    const png = await readFile(join(root, 'borrowed.png'));
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the composition export route answers 503 with the structured error when no browser starts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-png-route-'));
  const previous = { ...process.env };
  try {
    const models = join(root, 'models');
    await mkdir(models);
    await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
    await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
    const catalog = join(root, 'catalog.json');
    await writeFile(
      catalog,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'host', directory: join(models, 'host') },
          { id: 'plugin', directory: join(models, 'plugin') }
        ]
      })
    );
    process.env.FRACTAL_CATALOG = catalog;
    process.env.FRACTAL_CHROMIUM_PATH = join(root, 'no-such-chrome');
    resetCompositionState();
    const request = new Request('http://localhost/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'host', composition: 'plugins', format: 'png' })
    });
    const response = await POST({ request } as Parameters<typeof POST>[0]);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'png-export-chromium-not-found');
    assert.equal(body.path, join(root, 'no-such-chrome'));
    assert.ok(body.fix);
  } finally {
    process.env.FRACTAL_CATALOG = previous.FRACTAL_CATALOG;
    if (previous.FRACTAL_CHROMIUM_PATH === undefined) delete process.env.FRACTAL_CHROMIUM_PATH;
    else process.env.FRACTAL_CHROMIUM_PATH = previous.FRACTAL_CHROMIUM_PATH;
    resetCompositionState();
    await rm(root, { recursive: true, force: true });
  }
});
