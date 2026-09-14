import {
  CompositionContractError,
  MAX_COMPOSITION_STATE_BYTES,
  parseCompositionState
} from './parse';
import type { CompositionState, ProjectViewState, QualifiedSelection } from './types';

/**
 * Versioned, URL-safe encoding of `CompositionState` for permalinks and saved replay.
 *
 * The value is `v1.` plus unpadded base64url over a compact JSON object with short keys.
 * Only semantic composition fields are encoded: version, root, authored composition ID,
 * project entries (model, scene, mode, view), shared theme/layout, qualified selection and
 * focused project. Camera coordinates, filesystem paths, DOM state, loader handles,
 * resource-limit overrides and revision locks are never encoded, and decoding rejects any
 * value that carries them.
 *
 * Decoding bounds the input before doing work: values above 8 KiB encoded, or above
 * `MAX_COMPOSITION_STATE_BYTES` decoded, fail as `budget_exceeded`. The encoded bound
 * subsumes the decoded one today (8 KiB of base64url decodes to at most 6 KiB); the
 * decoded check stays as an independent gate so a future bound change cannot admit an
 * oversized payload. Malformed input throws `CompositionContractError` and is never
 * partially applied.
 */

/** Encoded payloads above this size are rejected before decoding. */
export const MAX_ENCODED_COMPOSITION_STATE_CHARS = 8 * 1024;

const VERSION_PREFIX = 'v1.';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBytes(bytes: Uint8Array): string {
  let bits = 0;
  let width = 0;
  let out = '';
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    width += 8;
    while (width >= 6) {
      width -= 6;
      out += BASE64URL[(bits >> width) & 63];
    }
  }
  if (width > 0) out += BASE64URL[(bits << (6 - width)) & 63];
  return out;
}

function decodeBytes(value: string, path: string): Uint8Array {
  if (!/^[A-Za-z0-9\-_]*$/.test(value))
    throw new CompositionContractError(path, 'must be base64url', 'invalid_contract');
  if (value.length % 4 === 1)
    throw new CompositionContractError(path, 'must be base64url', 'invalid_contract');
  const codes = new Map<string, number>([...BASE64URL].map((char, index) => [char, index]));
  const bytes: number[] = [];
  let bits = 0;
  let width = 0;
  for (const char of value) {
    bits = (bits << 6) | codes.get(char)!;
    width += 6;
    if (width >= 8) {
      width -= 8;
      bytes.push((bits >> width) & 255);
    }
  }
  return new Uint8Array(bytes);
}

type Compact = Record<string, unknown>;

function compactView(view: ProjectViewState): Compact {
  return {
    e: [...view.expanded],
    p: view.proposed,
    l: view.lens,
    ...(view.scope === undefined ? {} : { c: view.scope })
  };
}

function compactSelection(selection: QualifiedSelection): Compact {
  switch (selection.kind) {
    case 'project':
      return { k: 'project', m: selection.model };
    case 'element':
      return { k: 'element', m: selection.model, e: selection.element };
    case 'relationship':
      return { k: 'relationship', m: selection.model, r: selection.relationship };
    case 'boundary':
      return { k: 'boundary', m: selection.model, b: selection.boundary };
    case 'scene':
      return { k: 'scene', m: selection.model, s: selection.scene };
    case 'connection':
      return { k: 'connection', o: selection.ownerModel, c: selection.connectionId };
  }
}

function compactState(state: CompositionState): Compact {
  return {
    v: 1,
    r: state.root,
    ...(state.composition === undefined ? {} : { c: state.composition }),
    p: state.projects.map((project) => ({
      m: project.model,
      ...(project.scene === undefined ? {} : { s: project.scene }),
      o: project.mode,
      w: compactView(project.view)
    })),
    t: state.theme,
    y: state.layout,
    ...(state.selection === undefined ? {} : { q: compactSelection(state.selection) }),
    ...(state.focusedProject === undefined ? {} : { f: state.focusedProject })
  };
}

/**
 * Encode validated composition state as a versioned URL-safe value. The same 8 KiB
 * encoded cap the decoder enforces applies here, so every emitted value round-trips:
 * oversized state fails fast with `budget_exceeded` instead of producing a value no
 * reader (including this one) could decode.
 */
export function encodeCompositionState(state: CompositionState): string {
  const normalized = parseCompositionState(state);
  const json = JSON.stringify(compactState(normalized));
  const encoded = VERSION_PREFIX + encodeBytes(new TextEncoder().encode(json));
  if (encoded.length > MAX_ENCODED_COMPOSITION_STATE_CHARS)
    throw new CompositionContractError(
      'composition',
      `exceeds ${MAX_ENCODED_COMPOSITION_STATE_CHARS} encoded characters`,
      'budget_exceeded'
    );
  return encoded;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject(path: string, detail: string): never {
  throw new CompositionContractError(path, detail, 'invalid_contract');
}

/** Reject keys outside the compact schema; the parsed state parser checks the rest. */
function knownKeys(value: unknown, allowed: string[], path: string): Record<string, unknown> {
  if (!isObject(value)) reject(path, 'must be an object');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) reject(`${path}[${JSON.stringify(key)}]`, 'unsupported field');
  }
  return value;
}

function expandView(value: unknown, path: string): Record<string, unknown> {
  const compact = knownKeys(value, ['e', 'p', 'l', 'c'], path);
  const view: Record<string, unknown> = {
    expanded: compact.e,
    proposed: compact.p,
    lens: compact.l
  };
  if (compact.c !== undefined) view.scope = compact.c;
  return view;
}

function expandSelection(value: unknown, path: string): Record<string, unknown> {
  const compact = knownKeys(value, ['k', 'm', 'e', 'r', 'b', 's', 'o', 'c'], path);
  if (compact.k === 'connection')
    return { kind: 'connection', ownerModel: compact.o, connectionId: compact.c };
  const kind = compact.k;
  if (kind === 'project') return { kind, model: compact.m };
  const local = { element: 'e', relationship: 'r', boundary: 'b', scene: 's' } as const;
  const key = (local as Record<string, string>)[kind as string];
  if (key === undefined) reject(`${path}.k`, 'must be a known selection kind');
  return { kind, model: compact.m, [kind as string]: compact[key] };
}

function expandState(value: unknown): Record<string, unknown> {
  const compact = knownKeys(value, ['v', 'r', 'c', 'p', 't', 'y', 'q', 'f'], 'composition');
  if (compact.v !== 1)
    throw new CompositionContractError(
      'composition.version',
      'only version 1 is supported',
      'unsupported_version'
    );
  if (!Array.isArray(compact.p)) reject('composition.projects', 'must be an array');
  return {
    version: 1,
    root: compact.r,
    ...(compact.c === undefined ? {} : { composition: compact.c }),
    projects: (compact.p as unknown[]).map((entry, index) => {
      const path = `composition.projects[${index}]`;
      const project = knownKeys(entry, ['m', 's', 'o', 'w'], path);
      return {
        model: project.m,
        ...(project.s === undefined ? {} : { scene: project.s }),
        mode: project.o,
        view: expandView(project.w, `${path}.view`)
      };
    }),
    theme: compact.t,
    layout: compact.y,
    ...(compact.q === undefined
      ? {}
      : { selection: expandSelection(compact.q, 'composition.selection') }),
    ...(compact.f === undefined ? {} : { focusedProject: compact.f })
  };
}

/**
 * Decode a value produced by `encodeCompositionState`. Bounds the encoded input before
 * decoding and the decoded JSON before parsing; every failure throws
 * `CompositionContractError` and no partial state is ever returned.
 */
export function decodeCompositionState(value: string): CompositionState {
  if (typeof value !== 'string') reject('composition', 'must be a versioned composition value');
  if (value.length > MAX_ENCODED_COMPOSITION_STATE_CHARS)
    throw new CompositionContractError(
      'composition',
      `exceeds ${MAX_ENCODED_COMPOSITION_STATE_CHARS} encoded characters`,
      'budget_exceeded'
    );
  const prefix = /^v(\d+)\./.exec(value);
  if (!prefix) reject('composition', 'must be a versioned composition value');
  if (prefix[1] !== '1')
    throw new CompositionContractError(
      'composition.version',
      'only version 1 is supported',
      'unsupported_version'
    );
  const payload = value.slice(prefix[0].length);
  if (!payload) reject('composition', 'must carry a state payload');
  const bytes = decodeBytes(payload, 'composition');
  if (bytes.byteLength > MAX_COMPOSITION_STATE_BYTES)
    throw new CompositionContractError(
      'composition',
      `exceeds ${MAX_COMPOSITION_STATE_BYTES} bytes`,
      'budget_exceeded'
    );
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    reject('composition', 'must be UTF-8 JSON');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text!);
  } catch {
    reject('composition', 'must be JSON');
  }
  if (!isObject(parsed)) reject('composition', 'must be an object');
  return parseCompositionState(expandState(parsed));
}

/** The single URL parameter that carries composition state; single-model params keep theirs. */
export const COMPOSITION_URL_PARAM = 'composition';

/**
 * Read composition state from URL parameters. Returns undefined when the composition
 * parameter is absent or empty, so ordinary single-model URLs are untouched. A present
 * but malformed value throws `CompositionContractError`.
 */
export function compositionStateFromUrl(params: URLSearchParams): CompositionState | undefined {
  const value = params.get(COMPOSITION_URL_PARAM);
  if (value === null || value === '') return undefined;
  return decodeCompositionState(value);
}

/** Write composition state to one URL parameter, leaving every other parameter untouched. */
export function compositionStateToUrl(state: CompositionState, params: URLSearchParams): void {
  params.set(COMPOSITION_URL_PARAM, encodeCompositionState(state));
}
