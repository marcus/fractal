import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  COMPOSITION_URL_PARAM,
  compositionStateFromUrl,
  compositionStateToUrl,
  decodeCompositionState,
  encodeCompositionState,
  MAX_ENCODED_COMPOSITION_STATE_CHARS
} from '../src/lib/composition/codec';
import { CompositionContractError } from '../src/lib/composition/parse';
import type { CompositionState } from '../src/lib/composition/types';

const fixture = (path: string) =>
  readFile(new URL(`./fixtures/linked-projects/${path}`, import.meta.url), 'utf8');
const json = async (path: string) => JSON.parse(await fixture(path));
const valid = async (): Promise<CompositionState> => json('composition.json');

const payloadOf = (value: string): unknown =>
  JSON.parse(Buffer.from(value.slice('v1.'.length), 'base64url').toString('utf8'));

const encodedOf = (compact: unknown): string =>
  `v1.${Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url')}`;

function rejects(run: () => unknown, path: string, code = 'invalid_contract') {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof CompositionContractError && error.path === path && error.code === code
  );
}

test('composition state round-trips through the versioned URL-safe codec', async () => {
  const state = await valid();
  const encoded = encodeCompositionState(state);
  assert.match(encoded, /^v1\.[A-Za-z0-9\-_]+$/);
  assert.deepEqual(decodeCompositionState(encoded), state);
});

test('round-trip preserves collapsed modes, missing optionals and every selection kind', async () => {
  const state = await valid();
  const collapsed = structuredClone(state);
  collapsed.projects[0].mode = 'collapsed';
  assert.deepEqual(decodeCompositionState(encodeCompositionState(collapsed)), collapsed);

  const minimal: CompositionState = {
    version: 1,
    root: 'host',
    projects: [
      { model: 'host', mode: 'open', view: { expanded: [], proposed: false, lens: 'structure' } }
    ],
    theme: 'grove',
    layout: 'elk-layered'
  };
  assert.deepEqual(decodeCompositionState(encodeCompositionState(minimal)), minimal);

  const selections: CompositionState['selection'][] = [
    { kind: 'project', model: 'host' },
    { kind: 'element', model: 'host', element: 'cli' },
    { kind: 'relationship', model: 'host', relationship: 'call' },
    { kind: 'boundary', model: 'host', boundary: 'trust' },
    { kind: 'scene', model: 'plugin', scene: 'overview' },
    { kind: 'connection', ownerModel: 'host', connectionId: 'call' }
  ];
  for (const selection of selections) {
    const candidate = { ...structuredClone(state), selection };
    assert.deepEqual(decodeCompositionState(encodeCompositionState(candidate)), candidate);
  }
});

test('oversized values fail as budget_exceeded before decoding', () => {
  rejects(
    () => decodeCompositionState(`v1.${'A'.repeat(MAX_ENCODED_COMPOSITION_STATE_CHARS)}`),
    'composition',
    'budget_exceeded'
  );
  // Exactly at the bound is admitted past the size gate and fails later as malformed.
  rejects(
    () => decodeCompositionState(`v1.${'A'.repeat(MAX_ENCODED_COMPOSITION_STATE_CHARS - 3)}`),
    'composition'
  );
});

test('encode enforces the same cap the decoder applies, so every emitted value round-trips', () => {
  const stateWithPadding = (chars: number): CompositionState => ({
    version: 1,
    root: 'host',
    projects: [
      {
        model: 'host',
        mode: 'open',
        view: { expanded: ['x'.repeat(chars)], proposed: false, lens: 'structure' }
      }
    ],
    theme: 'grove',
    layout: 'elk-layered'
  });
  const encodedLength = (chars: number): number | undefined => {
    try {
      return encodeCompositionState(stateWithPadding(chars)).length;
    } catch {
      return undefined;
    }
  };
  let passing = 0;
  while (encodedLength(passing + 500) !== undefined) passing += 500;
  let failing = passing + 500;
  while (failing - passing > 1) {
    const mid = Math.floor((passing + failing) / 2);
    if (encodedLength(mid) === undefined) failing = mid;
    else passing = mid;
  }
  assert.throws(
    () => encodeCompositionState(stateWithPadding(failing)),
    (error: unknown) =>
      error instanceof CompositionContractError &&
      error.path === 'composition' &&
      error.code === 'budget_exceeded'
  );
  const under = encodeCompositionState(stateWithPadding(passing));
  assert.ok(under.length <= MAX_ENCODED_COMPOSITION_STATE_CHARS);
  assert.ok(under.length > MAX_ENCODED_COMPOSITION_STATE_CHARS - 4);
  assert.deepEqual(decodeCompositionState(under), stateWithPadding(passing));
});

test('wrong versions fail as unsupported_version', async () => {
  const state = await valid();
  const encoded = encodeCompositionState(state);
  rejects(
    () => decodeCompositionState(`v2.${encoded.slice(3)}`),
    'composition.version',
    'unsupported_version'
  );
  rejects(() => decodeCompositionState('v1.'), 'composition');
  rejects(() => decodeCompositionState('not-a-composition-value'), 'composition');
});

test('unknown compact fields fail with a path and encode carries no camera, paths or locks', async () => {
  const state = await valid();
  const compact = payloadOf(encodeCompositionState(state)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(compact).sort(), ['c', 'f', 'p', 'q', 'r', 't', 'v', 'y']);
  const raw = JSON.stringify(compact);
  for (const forbidden of ['camera', 'path', 'revision', 'dom', 'handle', 'limit']) {
    assert.ok(!raw.includes(forbidden), `encoded state must not mention ${forbidden}`);
  }
  rejects(() => decodeCompositionState(encodedOf({ ...compact, z: 1 })), 'composition["z"]');
  const project = (compact.p as Record<string, unknown>[])[0];
  rejects(
    () =>
      decodeCompositionState(
        encodedOf({ ...compact, p: [{ ...project, z: 1 }, (compact.p as unknown[])[1]] })
      ),
    'composition.projects[0]["z"]'
  );
  rejects(
    () => decodeCompositionState(encodedOf({ ...compact, v: 2 })),
    'composition.version',
    'unsupported_version'
  );
  rejects(() => decodeCompositionState('v1.!!!'), 'composition');
});

test('malformed input is never partially applied and decodes return fresh records', async () => {
  const state = await valid();
  const encoded = encodeCompositionState(state);
  assert.throws(() => decodeCompositionState(`${encoded.slice(0, 20)}!!!${encoded.slice(23)}`));
  assert.deepEqual(decodeCompositionState(encoded), state);

  const first = decodeCompositionState(encoded);
  const second = decodeCompositionState(encoded);
  assert.notEqual(first, second);
  first.projects[0].view.expanded.push('other');
  assert.deepEqual(second.projects[0].view.expanded, state.projects[0].view.expanded);
});

test('composition shares one URL parameter and leaves single-model parameters untouched', async () => {
  const state = await valid();
  const params = new URLSearchParams('model=host&scene=overview');
  compositionStateToUrl(state, params);
  assert.equal(params.get('model'), 'host');
  assert.equal(params.get('scene'), 'overview');
  assert.equal(params.get(COMPOSITION_URL_PARAM), encodeCompositionState(state));
  assert.deepEqual(compositionStateFromUrl(params), state);

  assert.equal(compositionStateFromUrl(new URLSearchParams('model=host')), undefined);
  assert.equal(compositionStateFromUrl(new URLSearchParams('composition=')), undefined);
  assert.throws(
    () => compositionStateFromUrl(new URLSearchParams('composition=bogus')),
    (error: unknown) => error instanceof CompositionContractError
  );
});
