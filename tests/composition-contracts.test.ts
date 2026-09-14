import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { qualifiedKey } from '../src/lib/composition/identity';
import {
  CompositionContractError,
  MAX_COMPOSITION_STATE_BYTES,
  parseCompositionDiagnostic,
  parseCompositionState,
  parseLinks
} from '../src/lib/composition/parse';
import type { IdentityOrigins } from '../src/lib/composition/types';

const fixture = (path: string) =>
  readFile(new URL(`./fixtures/linked-projects/${path}`, import.meta.url), 'utf8');
const json = async (path: string) => JSON.parse(await fixture(path));
function rejects(run: () => unknown, path: string, code = 'invalid_contract') {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof CompositionContractError && error.path === path && error.code === code
  );
}

test('fictional host/plugin retain colliding local IDs, hierarchy and memberships', async () => {
  const models = await Promise.all(
    ['host', 'plugin'].map(async (name) =>
      parseModel(await fixture(`${name}/model.c4`), await json(`${name}/fractal.json`))
    )
  );
  for (const model of models) {
    assert.equal(model.elements.find((element) => element.id === 'cli')?.parent, 'core');
    assert.deepEqual(model.boundaries[0].members, ['cli']);
    assert.equal(model.relationships[0].id, 'call');
    assert.equal(model.scenes[0].id, 'overview');
    const expected: IdentityOrigins = await json(`${model.id}/identity-origins.expected.json`);
    for (const element of model.elements) assert.ok(expected.elements[element.id]);
    assert.equal(expected.elements.core, 'explicit');
    assert.equal(expected.elements['core.fallback'], 'fallback');
    for (const id of ['core', 'core.fallback'])
      assert.equal(model.elements.find((element) => element.id === id)?.sourceId, id);
  }
  assert.notEqual(qualifiedKey('element', 'host', 'cli'), qualifiedKey('element', 'plugin', 'cli'));
});

test('qualified tuples preserve entity kind and ambiguous delimiter/Unicode input', () => {
  const keys = [
    qualifiedKey('element', 'a:b', 'c'),
    qualifiedKey('element', 'a', 'b:c'),
    qualifiedKey('relationship', 'a', 'b:c'),
    qualifiedKey('connection', 'a', 'b:c'),
    qualifiedKey('evidence', 'host', 'a', 'b:c'),
    qualifiedKey('evidence', 'host', 'a:b', 'c')
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(JSON.parse(qualifiedKey('element', 'host', '你好:"<>&')), [
    'element',
    'host',
    '你好:"<>&'
  ]);
});

test('links preserve owned reverse claims, root links and unavailable references without resolution', async () => {
  const host = parseLinks(await json('host/links.json'), 'host');
  const plugin = parseLinks(await json('plugin/links.json'), 'plugin');
  assert.equal(host.links[1].from, undefined);
  assert.equal(host.links[1].target.model, 'missing-plugin');
  assert.equal(host.connections[0].id, plugin.connections[0].id);
  assert.notEqual(
    qualifiedKey('connection', 'host', 'call'),
    qualifiedKey('connection', 'plugin', 'call')
  );
  assert.equal(plugin.connections[0].source.model, 'plugin');
  assert.deepEqual(parseLinks({ version: 1, links: [] }, 'host'), {
    version: 1,
    links: [],
    connections: [],
    compositions: []
  });
});

test('optional link fields default only when omitted and reject explicit null', async () => {
  const valid = await json('host/links.json');
  for (const field of ['connections', 'compositions']) {
    rejects(() => parseLinks({ ...valid, [field]: null }, 'host'), `links.${field}`);
  }
  for (const field of ['evidence', 'status', 'description']) {
    const bad = structuredClone(valid);
    bad.connections[0][field] = null;
    rejects(() => parseLinks(bad, 'host'), `links.connections[0].${field}`);
  }
  const omitted = structuredClone(valid);
  for (const field of ['evidence', 'status', 'description']) delete omitted.connections[0][field];
  const connection = parseLinks(omitted, 'host').connections[0];
  assert.deepEqual(connection.evidence, []);
  assert.equal(connection.status, 'current');
  assert.equal(connection.description, '');
});

test('links refuse unsupported contracts, duplicate IDs and undeclared/foreign-owned claims with paths', async () => {
  const valid = await json('host/links.json');
  rejects(
    () => parseLinks({ ...valid, version: 2 }, 'host'),
    'links.version',
    'unsupported_version'
  );
  rejects(() => parseLinks({ ...valid, directory: '/tmp' }, 'host'), 'links["directory"]');
  const extra = structuredClone(valid);
  extra.links[0].target.url = 'https://example.test';
  rejects(() => parseLinks(extra, 'host'), 'links.links[0].target["url"]');
  rejects(
    () => parseLinks({ ...valid, links: [valid.links[0], valid.links[0]] }, 'host'),
    'links.links[1]'
  );
  rejects(
    () =>
      parseLinks({ ...valid, connections: [valid.connections[0], valid.connections[0]] }, 'host'),
    'links.connections[1]'
  );
  const foreign = structuredClone(valid);
  foreign.connections[0].source.model = 'missing-plugin';
  rejects(() => parseLinks(foreign, 'host'), 'links.connections[0]');
  const missing = structuredClone(valid);
  missing.connections[0].target.model = 'undeclared';
  rejects(() => parseLinks(missing, 'host'), 'links.connections[0].target.model');
  const local = structuredClone(valid);
  local.connections[0].target.model = 'host';
  rejects(() => parseLinks(local, 'host'), 'links.connections[0]');
  const root = structuredClone(valid);
  root.compositions[0].projects[0].model = 'host';
  rejects(() => parseLinks(root, 'host'), 'links.compositions[0].projects[0].model');
  for (const evidence of ['/private/file', '../sibling/file', 'https://example.test', 'C:\\file']) {
    const bad = structuredClone(valid);
    bad.connections[0].evidence = [evidence];
    rejects(() => parseLinks(bad, 'host'), 'links.connections[0].evidence[0]');
  }
});

test('resolved composition state round-trips and retains a collapsed root or project view', async () => {
  const state = await json('composition.json');
  assert.deepEqual(parseCompositionState(state), state);
  state.projects[0].mode = 'collapsed';
  assert.equal(parseCompositionState(state).projects[0].mode, 'collapsed');
  const parsed = parseCompositionState(state);
  parsed.projects[0].view.expanded.push('other');
  assert.deepEqual(state.projects[0].view.expanded, ['core']);
});

test('state rejects partial roots, duplicate frames, orphan selections and local presentation overrides', async () => {
  const valid = await json('composition.json');
  rejects(() => parseCompositionState({ ...valid, projects: [] }), 'composition.projects[0]');
  rejects(
    () => parseCompositionState({ ...valid, projects: [valid.projects[1], valid.projects[0]] }),
    'composition.projects[0]'
  );
  rejects(
    () => parseCompositionState({ ...valid, projects: [valid.projects[0], valid.projects[0]] }),
    'composition.projects[1]'
  );
  rejects(
    () =>
      parseCompositionState({
        ...valid,
        selection: { kind: 'element', model: 'missing-plugin', element: 'cli' }
      }),
    'composition.selection'
  );
  rejects(
    () =>
      parseCompositionState({
        ...valid,
        selection: { kind: 'connection', ownerModel: 'missing-plugin', connectionId: 'call' }
      }),
    'composition.selection'
  );
  rejects(
    () => parseCompositionState({ ...valid, focusedProject: 'missing-plugin' }),
    'composition.focusedProject'
  );
  for (const field of ['theme', 'layout']) {
    const bad = structuredClone(valid);
    bad.projects[0].view[field] = valid[field];
    rejects(() => parseCompositionState(bad), `composition.projects[0].view["${field}"]`);
  }
  const bad = structuredClone(valid);
  bad.projects[0].view.proposed = 'false';
  rejects(() => parseCompositionState(bad), 'composition.projects[0].view.proposed');
  rejects(
    () =>
      parseCompositionState({
        ...valid,
        selection: { kind: 'element', model: 'host', element: 'cli', scene: 'overview' }
      }),
    'composition.selection["scene"]'
  );
  rejects(
    () => parseCompositionState({ ...valid, version: 42 }),
    'composition.version',
    'unsupported_version'
  );
  rejects(
    () =>
      parseCompositionState({ ...valid, composition: 'é'.repeat(MAX_COMPOSITION_STATE_BYTES / 2) }),
    'composition',
    'budget_exceeded'
  );
});

test('diagnostics round-trip owner/claim/target/recovery and budget measurements without hidden fallback', () => {
  const missing = {
    code: 'endpoint_missing',
    ownerModel: 'host',
    connectionId: 'call',
    target: { model: 'plugin', element: 'removed' },
    message: 'The authored endpoint is missing.',
    path: 'links.connections[0].target',
    recovery: 'repair'
  };
  assert.deepEqual(parseCompositionDiagnostic(missing), missing);
  const budget = {
    code: 'budget_exceeded',
    ownerModel: 'host',
    message: 'Too many visible nodes.',
    recovery: 'reduce',
    budget: { resource: 'visible_nodes', actual: 501, limit: 500 }
  };
  assert.deepEqual(parseCompositionDiagnostic(budget), budget);
  rejects(() => parseCompositionDiagnostic({ ...budget, budget: undefined }), 'diagnostic.budget');
  rejects(
    () => parseCompositionDiagnostic({ ...budget, budget: { ...budget.budget, actual: NaN } }),
    'diagnostic.budget.actual'
  );
  rejects(() => parseCompositionDiagnostic({ ...missing, code: 'not_loaded' }), 'diagnostic.code');
  rejects(
    () => parseCompositionDiagnostic({ ...missing, recovery: 'guess_by_title' }),
    'diagnostic.recovery'
  );
});
