import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeCompositionState } from '../composition/codec';
import { compose } from '../composition/compose';
import { inspectQualified, type QualifiedInspection } from '../composition/inspect';
import {
  checkAdmission,
  DEFAULT_COMPOSITION_LIMITS,
  estimateBytes,
  type CompositionCounts,
  type CompositionLimits
} from '../composition/limits';
import { parseCompositionState } from '../composition/parse';
import {
  revisionConflicts,
  type CompositionGeneration,
  type RevisionVector
} from '../composition/revision';
import { searchComposition, type CompositionSearchResult } from '../composition/search';
import type { ProjectSnapshot, ResolutionOutcome, SnapshotResolver } from '../composition/snapshot';
import { rootState, stateFromComposition } from '../composition/state';
import type {
  ComposedDiagram,
  CompositionDiagnostic,
  CompositionState,
  ProjectLinks
} from '../composition/types';
import type { LayoutEngineId, Model, ThemeId } from '../core/types';
import { createCache, serverCachePool, type CacheSnapshot } from './cache';
import {
  catalogReloader,
  catalogResolver,
  clearModelCache,
  loadModel,
  modelCacheStats,
  resolveProject,
  snapshotOf,
  type CatalogOptions
} from './models';
import { compositionWorkQueue, resetCompositionQueue, type JobsSnapshot } from './queue';
import { clearRenderCache, renderCacheStats } from './render';

/**
 * The application boundary for linked composition: the CLI and HTTP routes both call these small
 * functions so no resolution, validation or caching rule is duplicated in a handler. Only the
 * configured catalog is ever read; the core composition library stays transport-free.
 */

/**
 * A caller error: mutually exclusive selectors, an unknown root or an unknown authored
 * composition. Routes translate it to HTTP 400; it signals bad input, not a failed target.
 */
export class CompositionUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompositionUsageError';
  }
}

/**
 * A participating source changed under the caller's coherent view: the loaded revision
 * differs from the vector the caller composed against. Routes translate it to HTTP 409;
 * the caller reloads and retries with the fresh vector.
 */
export class RevisionConflictError extends Error {
  readonly code = 'revision_changed' as const;
  readonly recovery = 'reload' as const;
  readonly model: string;
  readonly expected: string;
  readonly actual: string;
  constructor(model: string, expected: string, actual: string) {
    super(`${model} changed on disk. Reload the composition before continuing.`);
    this.name = 'RevisionConflictError';
    this.model = model;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The composition exceeds its admission limits. The result is refused whole — never
 * truncated — so the caller collapses, focuses or narrows the composition and retries.
 * Routes translate it to HTTP 422; the CLI exits nonzero.
 */
export class BudgetExceededError extends Error {
  readonly code = 'budget_exceeded' as const;
  readonly diagnostics: CompositionDiagnostic[];
  constructor(diagnostics: CompositionDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'The composition exceeds its resource budget.');
    this.name = 'BudgetExceededError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Per-request composition options. Limit overrides live here (service configuration only);
 * untrusted callers pass revisions and generations, never limits.
 */
export interface CompositionRequest extends CatalogOptions {
  /**
   * The revision vector the caller composed against. Every participating model present in
   * both vectors must match; the first mismatch (in model order) throws
   * `RevisionConflictError`. Models the loader never resolved cannot conflict.
   */
  revisions?: RevisionVector;
  /**
   * Client-owned monotonic generation, echoed verbatim in the result. Cancelled or older
   * generations never replace newer state: slow responses carry their generation and the
   * caller discards any response older than its latest dispatch. Stale answers are scoped
   * by `client`; without a client id the queue never answers stale.
   */
  generation?: CompositionGeneration;
  /**
   * Opaque per-caller identity (at most 64 characters) that scopes generation tracking.
   * Two tabs of the same root keep independent generation counters. Omit it to skip
   * stale answers while still coalescing identical in-flight work.
   */
  client?: string;
  /**
   * Reload every participating snapshot fresh with stamp verification (one retry, then
   * `SourceChangingError`) instead of trusting the parse cache.
   */
  reload?: boolean;
}

/**
 * Accept an explicit composition state as a decoded object or as a versioned encoded
 * `v1.` permalink value. Anything else is parsed as resolved state; malformed input is
 * never partially applied.
 */
export function resolveCompositionStateInput(value: unknown): CompositionState {
  if (typeof value === 'string' && value.startsWith('v1.')) return decodeCompositionState(value);
  return parseCompositionState(value);
}

/** The traversal budget for strict linked validation, in distinct models. */
export const LINKED_TRAVERSAL_BUDGET = 20;

/** The minimum a caller must supply for links discovery: parsed links and the content revision. */
export interface LocatedProject {
  model: Model;
  links: ProjectLinks | null;
  revision: string;
}

export interface LinkResolution {
  model: string;
  status: 'resolved' | 'unavailable' | 'invalid';
  message?: string;
}

export interface LinksResult {
  model: string;
  revision: string;
  links: ProjectLinks | null;
  /** One entry per distinct foreign model named by links or connections, sorted by model. */
  resolution: LinkResolution[];
}

export interface LinkedValidation {
  valid: boolean;
  model: string;
  diagnostics: CompositionDiagnostic[];
}

export interface CompositionSelector {
  /** Authored composition ID from the root's links.json. */
  composition?: string;
  /** Path to an explicit resolved state file; read by this boundary, never by a route. */
  stateFile?: string;
  /**
   * Explicit resolved state: a decoded object or a versioned encoded `v1.` permalink
   * value. Mutually exclusive with `composition`.
   */
  state?: unknown;
  scene?: string;
  theme?: ThemeId;
  layout?: LayoutEngineId;
}

export interface CompositionResult {
  state: CompositionState;
  composed: ComposedDiagram;
  revisions: Record<string, string>;
  /**
   * The caller's generation echoed verbatim, present only when the request carried one.
   * It is never part of the cache key: the same content serves every generation, and the
   * caller discards responses older than its latest dispatch.
   */
  generation?: CompositionGeneration;
}

const COMPOSITION_CACHE_LIMIT = 64;
/**
 * Composed results, bounded by entries and estimated bytes (local geometry plus routed
 * bridge geometry). Entries are tagged with every participating model so editing one
 * target drops exactly the compositions that included it; the pool evicts these before
 * layouts and parsed models when retained bytes run over budget.
 */
const composedCache = createCache<CompositionResult>(COMPOSITION_CACHE_LIMIT, {
  maxBytes: 32 * 1024 * 1024,
  sizeOf: (result) => estimateBytes(result.composed),
  pool: serverCachePool,
  priority: 0
});

/** Work refused since the last reset: superseded generations and over-limit compositions. */
const rejected = { stale: 0, overLimit: 0 };

const LIMIT_FIELDS = [
  'projects',
  'loadedElements',
  'relationships',
  'visibleNodes',
  'visibleEdges',
  'sourceBytesPerProject',
  'cacheBytes'
] as const;

/** Parsed service configuration per environment object, so the process environment parses once. */
let envLimitsCache = new WeakMap<NodeJS.ProcessEnv, CompositionLimits>();

function parseEnvLimits(env: NodeJS.ProcessEnv): CompositionLimits {
  const raw = env.FRACTAL_COMPOSITION_LIMITS;
  if (raw === undefined || raw === '') return DEFAULT_COMPOSITION_LIMITS;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new CompositionUsageError(
      'FRACTAL_COMPOSITION_LIMITS must be a JSON object of limit overrides.'
    );
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded))
    throw new CompositionUsageError(
      'FRACTAL_COMPOSITION_LIMITS must be a JSON object of limit overrides.'
    );
  const limits: CompositionLimits = { ...DEFAULT_COMPOSITION_LIMITS };
  for (const [field, value] of Object.entries(decoded as Record<string, unknown>)) {
    if (!(LIMIT_FIELDS as readonly string[]).includes(field))
      throw new CompositionUsageError(
        `Unknown composition limit: ${field} (known: ${LIMIT_FIELDS.join(', ')}).`
      );
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new CompositionUsageError(`Composition limit ${field} must be a finite number >= 0.`);
    limits[field as (typeof LIMIT_FIELDS)[number]] = value;
  }
  return limits;
}

/**
 * The admission limits for this call: an explicit service/CLI override wins, otherwise the
 * `FRACTAL_COMPOSITION_LIMITS` JSON object from the service environment (parsed once per
 * environment), otherwise the plan defaults. Untrusted input — URLs, saved state, HTTP
 * bodies — can never raise a limit: no request field reaches this function.
 */
export function effectiveLimits(
  options: { limits?: CompositionLimits; env?: NodeJS.ProcessEnv } = {}
): CompositionLimits {
  if (options.limits !== undefined) return options.limits;
  const env = options.env ?? process.env;
  const cached = envLimitsCache.get(env);
  if (cached) return cached;
  const parsed = parseEnvLimits(env);
  envLimitsCache.set(env, parsed);
  return parsed;
}

/**
 * Keep the process-wide retained-bytes pool aligned with the service-configured
 * `cacheBytes`. Per-request limit overrides govern admission only: one pool serves every
 * request, so it cannot follow them.
 */
function syncServerCachePool(): void {
  serverCachePool.setMaxBytes(effectiveLimits({}).cacheBytes);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A stable string for any JSON-shaped value; the same shape `server/render.ts` cache keys use. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The identity of a composed result: the canonical state plus the content revision of every
 * participating project. Collapsing an already-collapsed project or following a link that names
 * the same projects in another order still yields different state, so those stay distinct.
 */
export function compositionKey(state: CompositionState, revisions: Record<string, string>): string {
  const vector = Object.keys(revisions)
    .sort()
    .map((model) => [model, revisions[model]]);
  return canonical({ state, revisions: vector });
}

/** Distinct foreign models named by a project's links and connections, sorted. */
function foreignModels(owner: string, links: ProjectLinks | null): string[] {
  if (!links) return [];
  const models = new Set<string>();
  for (const link of links.links) models.add(link.target.model);
  for (const connection of links.connections) {
    if (connection.source.model !== owner) models.add(connection.source.model);
    if (connection.target.model !== owner) models.add(connection.target.model);
  }
  models.delete(owner);
  return [...models].sort(compare);
}

/** The catalog slug syntax a link target must use before any catalog lookup. */
const catalogSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The availability of one declared target from catalog metadata alone: registered, directory
 * present, companion readable and id-matching, `model.c4` present. This deliberately does not
 * compile the model, so listing links never parses a foreign project; opening it or
 * `validate --linked` performs the full load and reports a malformed source as `model_invalid`.
 */
async function availability(model: string, options: CatalogOptions): Promise<LinkResolution> {
  if (!catalogSlug.test(model))
    return {
      model,
      status: 'unavailable',
      message: `Model ${model} is not a valid catalog identifier.`
    };
  try {
    await resolveProject(model, options);
    return { model, status: 'resolved' };
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('Unknown model:') || message.startsWith('Model directory missing:'))
      return { model, status: 'unavailable', message };
    return { model, status: 'invalid', message };
  }
}

/**
 * Availability status for every foreign model a project names, without composing or compiling
 * anything: each target is checked from entry metadata on its own, so one bad target never hides
 * a healthy one and the root's links list stays cheap.
 */
export async function linksForLocated(
  loaded: LocatedProject,
  options: CatalogOptions = {}
): Promise<LinksResult> {
  const resolution: LinkResolution[] = [];
  for (const model of foreignModels(loaded.model.id, loaded.links))
    resolution.push(await availability(model, options));
  return { model: loaded.model.id, revision: loaded.revision, links: loaded.links, resolution };
}

/** Unknown roots throw; a root in the catalog is loaded and validated exactly like any target. */
export async function linksFor(model: string, options: CatalogOptions = {}): Promise<LinksResult> {
  return linksForLocated(await loadModel(model, options), options);
}

function recoveryFor(code: CompositionDiagnostic['code']): CompositionDiagnostic['recovery'] {
  if (code === 'model_unavailable') return 'register';
  if (code === 'unsupported_version') return 'upgrade';
  return 'repair';
}

/** Local `from`/endpoint existence and explicit-UID diagnostics for one owning project. */
function localDiagnostics(
  owner: ProjectSnapshot,
  snapshots: Map<string, ProjectSnapshot>
): CompositionDiagnostic[] {
  const links = owner.links;
  if (!links) return [];
  const diagnostics: CompositionDiagnostic[] = [];
  links.links.forEach((link, index) => {
    if (link.from === undefined) return;
    const target = {
      model: link.target.model,
      ...(link.target.scene === undefined ? {} : { scene: link.target.scene })
    };
    const path = `links.links[${index}].from`;
    if (!owner.model.elements.some((element) => element.id === link.from)) {
      diagnostics.push({
        code: 'endpoint_missing',
        ownerModel: owner.id,
        message: `The authored link element ${link.from} is missing.`,
        linkId: link.id,
        target,
        path,
        recovery: 'repair'
      });
    } else if (owner.origins.elements[link.from] !== 'explicit') {
      diagnostics.push({
        code: 'identity_not_explicit',
        ownerModel: owner.id,
        message: `The authored link element ${link.from} has no explicit stable UID.`,
        linkId: link.id,
        target,
        path,
        recovery: 'repair'
      });
    }
  });
  links.connections.forEach((connection, index) => {
    for (const [name, ref] of [
      ['source', connection.source],
      ['target', connection.target]
    ] as const) {
      const snapshot = ref.model === owner.id ? owner : snapshots.get(ref.model);
      if (!snapshot) continue;
      const target = { model: ref.model, element: ref.element };
      const path = `links.connections[${index}].${name}`;
      if (!snapshot.model.elements.some((element) => element.id === ref.element)) {
        diagnostics.push({
          code: 'endpoint_missing',
          ownerModel: owner.id,
          message: `The authored ${name} element ${ref.element} is missing from ${ref.model}.`,
          connectionId: connection.id,
          target,
          path,
          recovery: 'repair'
        });
      } else if (snapshot.origins.elements[ref.element] !== 'explicit') {
        diagnostics.push({
          code: 'identity_not_explicit',
          ownerModel: owner.id,
          message: `The authored ${name} element ${ref.element} has no explicit stable UID.`,
          connectionId: connection.id,
          target,
          path,
          recovery: 'repair'
        });
      }
    }
  });
  return diagnostics;
}

interface DeclaredTarget {
  model: string;
  target: { model: string; element?: string; scene?: string };
  linkId?: string;
  connectionId?: string;
}

/** Declared foreign targets of one project: link targets and the non-owned endpoint of a claim. */
function declaredTargets(owner: ProjectSnapshot): DeclaredTarget[] {
  const links = owner.links;
  if (!links) return [];
  const targets: DeclaredTarget[] = [];
  for (const link of links.links)
    targets.push({
      model: link.target.model,
      target: {
        model: link.target.model,
        ...(link.target.scene === undefined ? {} : { scene: link.target.scene })
      },
      linkId: link.id
    });
  for (const connection of links.connections) {
    const foreign = connection.source.model === owner.id ? connection.target : connection.source;
    if (foreign.model === owner.id) continue;
    targets.push({
      model: foreign.model,
      target: { model: foreign.model, element: foreign.element },
      connectionId: connection.id
    });
  }
  return targets;
}

/**
 * Strict linked validation: resolve the declared link closure with a visited set first (a
 * target's own links are followed only once it resolves), then validate every participating
 * owner's connections against every resolved endpoint model. Checking endpoints only after
 * the closure is complete keeps validation symmetric: a claim the traversal reaches late
 * is judged against the same snapshots as one reached early, regardless of visit order.
 * Unresolved claims are diagnostics, never throws; only an unknown root or a malformed
 * root model fails the call. Exceeding the model traversal budget adds one
 * `budget_exceeded` diagnostic.
 */
export async function validateLinkedSnapshot(
  root: ProjectSnapshot,
  options: CatalogOptions = {}
): Promise<LinkedValidation> {
  const resolver = catalogResolver(options);
  const snapshots = new Map<string, ProjectSnapshot>([[root.id, root]]);
  const outcomes = new Map<string, ResolutionOutcome>([
    [root.id, { status: 'resolved', snapshot: root }]
  ]);
  const visited = new Set<string>([root.id]);
  const queue: ProjectSnapshot[] = [root];
  const diagnostics: CompositionDiagnostic[] = [];
  let budgetReported = false;

  while (queue.length) {
    const owner = queue.shift()!;
    for (const ref of declaredTargets(owner)) {
      if (snapshots.has(ref.model)) continue;
      let outcome = outcomes.get(ref.model);
      if (!outcome) {
        if (visited.size >= LINKED_TRAVERSAL_BUDGET) {
          if (!budgetReported) {
            budgetReported = true;
            diagnostics.push({
              code: 'budget_exceeded',
              ownerModel: owner.id,
              message: `Linked validation exceeds the ${LINKED_TRAVERSAL_BUDGET}-model traversal budget.`,
              target: ref.target,
              recovery: 'reduce',
              budget: {
                resource: 'models',
                actual: visited.size + 1,
                limit: LINKED_TRAVERSAL_BUDGET
              }
            });
          }
          continue;
        }
        visited.add(ref.model);
        outcome = await resolver.resolve(ref.model);
        outcomes.set(ref.model, outcome);
      }
      if (outcome.status === 'resolved') {
        snapshots.set(ref.model, outcome.snapshot);
        queue.push(outcome.snapshot);
      } else {
        diagnostics.push({
          code: outcome.code,
          ownerModel: owner.id,
          message: outcome.message,
          ...(ref.linkId === undefined ? {} : { linkId: ref.linkId }),
          ...(ref.connectionId === undefined ? {} : { connectionId: ref.connectionId }),
          target: ref.target,
          recovery: recoveryFor(outcome.code)
        });
      }
    }
  }

  for (const owner of snapshots.values()) diagnostics.push(...localDiagnostics(owner, snapshots));

  diagnostics.sort(
    (a, b) => compare(a.ownerModel, b.ownerModel) || compare(a.path ?? '', b.path ?? '')
  );
  return { valid: diagnostics.length === 0, model: root.id, diagnostics };
}

export async function validateLinked(
  model: string,
  options: CatalogOptions = {}
): Promise<LinkedValidation> {
  return validateLinkedSnapshot(snapshotOf(await loadModel(model, options)), options);
}

async function loadRootSnapshot(
  model: string,
  resolver: SnapshotResolver
): Promise<ProjectSnapshot> {
  const outcome = await resolver.resolve(model);
  if (outcome.status !== 'resolved') throw new CompositionUsageError(outcome.message);
  return outcome.snapshot;
}

function replayResolver(outcomes: Map<string, ResolutionOutcome>): SnapshotResolver {
  return {
    async resolve(model) {
      const outcome = outcomes.get(model);
      if (outcome) return outcome;
      return {
        status: 'unavailable',
        code: 'model_unavailable',
        message: `Model ${model} is not registered.`
      };
    }
  };
}

async function resolveAdditional(
  outcomes: Map<string, ResolutionOutcome>,
  models: string[],
  resolver: SnapshotResolver
): Promise<void> {
  for (const model of models) {
    if (!outcomes.has(model)) outcomes.set(model, await resolver.resolve(model));
  }
}

/**
 * Visible geometry toward the `visibleNodes`/`visibleEdges` gates: laid-out local nodes
 * and edges, plus one visible connection per drawn bridge and one visible stand-in per
 * perimeter port and reference stub. Bridge geometry is resource accounting, not free:
 * a composition of quiet projects joined by hundreds of claims is refused under the
 * same visible gates as a dense local diagram.
 */
export function visibleAdmissionCounts(composed: ComposedDiagram): {
  visibleNodes: number;
  visibleEdges: number;
} {
  let visibleNodes = composed.stubs.length;
  let visibleEdges = composed.bridges.length;
  for (const project of composed.projects) {
    if (project.diagram) {
      visibleNodes += project.diagram.nodes.length;
      visibleEdges += project.diagram.edges.length;
    }
    visibleNodes += project.ports.length;
  }
  return { visibleNodes, visibleEdges };
}

/**
 * Admission counts from resolved snapshots and a composed diagram, shared by
 * `composeFromSelector` and the linked HTML export so both gates count the same
 * geometry. Loaded counts cover every resolved snapshot; collapsed projects keep no
 * diagram but their snapshots still load. Source and cache bytes are deterministic
 * serialization-size approximations, not heap measurements. An over-limit composition
 * is refused whole, never truncated.
 */
export function snapshotAdmissionCounts(
  projects: number,
  snapshots: ProjectSnapshot[],
  composed: ComposedDiagram
): CompositionCounts {
  let loadedElements = 0;
  let relationships = 0;
  let sourceBytesPerProject = 0;
  let snapshotBytes = 0;
  for (const snapshot of snapshots) {
    loadedElements += snapshot.model.elements.length;
    relationships += snapshot.model.relationships.length;
    const bytes = estimateBytes(snapshot);
    snapshotBytes += bytes;
    if (bytes > sourceBytesPerProject) sourceBytesPerProject = bytes;
  }
  const { visibleNodes, visibleEdges } = visibleAdmissionCounts(composed);
  return {
    projects,
    loadedElements,
    relationships,
    visibleNodes,
    visibleEdges,
    sourceBytesPerProject,
    cacheBytes: estimateBytes(composed) + snapshotBytes
  };
}

/** Admission counts for a composed result: every resolved outcome's snapshot counts. */
function admissionCounts(
  state: CompositionState,
  outcomes: Map<string, ResolutionOutcome>,
  composed: ComposedDiagram
): CompositionCounts {
  const snapshots: ProjectSnapshot[] = [];
  for (const outcome of outcomes.values()) {
    if (outcome.status !== 'resolved') continue;
    snapshots.push(outcome.snapshot);
  }
  return snapshotAdmissionCounts(state.projects.length, snapshots, composed);
}

function checkGeneration(
  generation: unknown
): asserts generation is CompositionGeneration | undefined {
  if (generation === undefined) return;
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0)
    throw new CompositionUsageError('generation must be a nonnegative integer');
}

function checkClient(client: unknown): asserts client is string | undefined {
  if (client === undefined) return;
  if (typeof client !== 'string' || client.length === 0 || client.length > 64)
    throw new CompositionUsageError('client must be an opaque string of at most 64 characters');
}

function checkRevisionVector(revisions: unknown): asserts revisions is RevisionVector | undefined {
  if (revisions === undefined) return;
  if (typeof revisions !== 'object' || revisions === null || Array.isArray(revisions))
    throw new CompositionUsageError('revisions must be an object');
  for (const revision of Object.values(revisions as Record<string, unknown>))
    if (typeof revision !== 'string')
      throw new CompositionUsageError('revisions values must be strings');
}

function revisionVector(
  state: CompositionState,
  outcomes: Map<string, ResolutionOutcome>
): Record<string, string> {
  const revisions: Record<string, string> = {};
  for (const project of state.projects) {
    const outcome = outcomes.get(project.model);
    if (outcome?.status === 'resolved') revisions[project.model] = outcome.snapshot.revision;
  }
  return revisions;
}

/**
 * Build a composition from an authored `composition` ID or an explicit saved state, compose it,
 * and cache by canonical state plus the participating revision vector. `--composition` and an
 * explicit state are mutually exclusive. `root` may be a model ID or an already-loaded snapshot
 * so the CLI's explicit `--directory` entry point shares the same catalog-backed resolution.
 *
 * `options.revisions` carries the vector the caller composed against: a participating source
 * whose loaded revision differs throws `RevisionConflictError` before any geometry is reused.
 * `options.generation` is echoed verbatim so callers discard superseded responses.
 * `options.reload` parses every participating snapshot fresh with stamp verification instead
 * of trusting the parse cache. Admission limits (`options.limits`, service configuration
 * only) are checked on loaded and visible counts before returning; an over-limit
 * composition throws `BudgetExceededError` whole and is never cached or truncated.
 */
/**
 * The identity of a cached composed result: the canonical state, the participating revision
 * vector, and the effective admission limits. Limits join the key so a stricter service
 * configuration never receives a result admitted — and cached — under looser limits.
 */
function compositionCacheKey(
  state: CompositionState,
  revisions: Record<string, string>,
  limits: CompositionLimits
): string {
  return `${compositionKey(state, revisions)}\0${canonical(limits)}`;
}

export async function composeFromSelector(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  options: CompositionRequest = {}
): Promise<CompositionResult> {
  const explicitState = selector.state !== undefined || selector.stateFile !== undefined;
  if (selector.composition !== undefined && explicitState)
    throw new CompositionUsageError(
      '--composition and an explicit composition state are mutually exclusive'
    );
  if (selector.state !== undefined && selector.stateFile !== undefined)
    throw new CompositionUsageError('composition state and state file are mutually exclusive');
  checkRevisionVector(options.revisions);
  checkGeneration(options.generation);

  // Reloads resolve through stamp-verified fresh parses; ordinary renders use the cache.
  const loader = options.reload === true ? catalogReloader(options) : catalogResolver(options);
  const rootSnapshot = typeof root === 'string' ? await loadRootSnapshot(root, loader) : root;
  const outcomes = new Map<string, ResolutionOutcome>([
    [rootSnapshot.id, { status: 'resolved', snapshot: rootSnapshot }]
  ]);

  let state: CompositionState;
  if (selector.composition !== undefined) {
    const composition = rootSnapshot.links?.compositions.find(
      (candidate) => candidate.id === selector.composition
    );
    if (!composition)
      throw new CompositionUsageError(`Unknown composition: ${selector.composition}`);
    await resolveAdditional(
      outcomes,
      composition.projects.map((project) => project.model),
      loader
    );
    state = stateFromComposition(rootSnapshot, selector.composition, (model) => {
      const outcome = outcomes.get(model);
      return outcome?.status === 'resolved' ? outcome.snapshot : undefined;
    });
  } else if (explicitState) {
    const raw =
      selector.stateFile !== undefined
        ? JSON.parse(await readFile(resolve(selector.stateFile), 'utf8'))
        : selector.state;
    state = resolveCompositionStateInput(raw);
    if (state.root !== rootSnapshot.id)
      throw new CompositionUsageError(
        `Composition state root ${state.root} does not match the resolved root ${rootSnapshot.id}`
      );
  } else {
    state = rootState(rootSnapshot, {
      scene: selector.scene,
      theme: selector.theme,
      layout: selector.layout
    });
  }

  await resolveAdditional(
    outcomes,
    state.projects.map((project) => project.model),
    loader
  );
  // Only successfully validated snapshots contribute revisions: an unopened target adds its
  // revision after validation, and a model the loader never resolved has no revision here.
  const revisions = revisionVector(state, outcomes);
  if (options.revisions !== undefined) {
    const [conflict] = revisionConflicts(options.revisions, revisions);
    if (conflict)
      throw new RevisionConflictError(conflict.model, conflict.expected, conflict.actual);
  }
  const withGeneration = (result: CompositionResult): CompositionResult =>
    options.generation === undefined ? result : { ...result, generation: options.generation };
  // Limits are resolved before the cache lookup and join its key: a hit was admitted under
  // these exact limits, so a stricter configuration can never be served a cached over-limit
  // result. A refusal throws before storing, so the previous cached view is retained whole.
  const limits = effectiveLimits(options);
  syncServerCachePool();
  const key = compositionCacheKey(state, revisions, limits);
  const cached = composedCache.get(key);
  if (cached) return withGeneration(structuredClone(cached));

  const composed = await compose(replayResolver(outcomes), state);
  const over = checkAdmission(admissionCounts(state, outcomes, composed), limits, state.root);
  if (over.length > 0) {
    rejected.overLimit += 1;
    throw new BudgetExceededError(over);
  }
  const result: CompositionResult = { state, composed, revisions };
  composedCache.set(key, structuredClone(result), { tags: Object.keys(revisions) });
  return withGeneration(result);
}

/**
 * Reload a composition against current sources: every participating snapshot is parsed
 * fresh with stamp verification (one retry, then `SourceChangingError`) and the composed
 * cache is bypassed by the fresh revision vector. The response carries the new vector;
 * callers adopt it for subsequent revision checks.
 */
export async function reloadComposition(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  options: CompositionRequest = {}
): Promise<CompositionResult> {
  return composeFromSelector(root, selector, { ...options, reload: true });
}

/** Forget every composed result. Tests use this to start from a cold cache. */
export function clearCompositionCache(): void {
  composedCache.clear();
}

/** Compositions computed and reused, entries, estimated bytes and evictions. A test seam and metric. */
export function compositionCacheStats(): CacheSnapshot {
  return composedCache.snapshot();
}

export type CompositionRenderOutcome =
  | { status: 'ready'; result: CompositionResult; coalesced: boolean }
  | { status: 'stale'; generation: number; current: number };

/**
 * The HTTP service's render path: one bounded queue per server for resolution and layout
 * jobs (two concurrent, identical in-flight requests coalesced). A request carrying an
 * older `generation` than the latest for the same root+client is answered `stale` without
 * doing work. Without a client id the queue never answers stale. The CLI calls
 * `composeFromSelector` directly and never queues.
 */
export async function submitCompositionRender(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  options: CompositionRequest = {}
): Promise<CompositionRenderOutcome> {
  checkGeneration(options.generation);
  checkClient(options.client);
  const scope = typeof root === 'string' ? root : root.id;
  // The queue key covers everything that changes the work; generation and client are
  // excluded because the same content serves every generation, and the caller discards
  // superseded responses. Limits are included so a stricter request never shares an
  // admitted request's work.
  const key = canonical({
    selector,
    revisions: options.revisions ?? null,
    reload: options.reload ?? false,
    limits: effectiveLimits(options)
  });
  const outcome = await compositionWorkQueue.submit(
    scope,
    key,
    () => composeFromSelector(root, selector, options),
    {
      ...(options.generation === undefined ? {} : { generation: options.generation }),
      ...(options.client === undefined ? {} : { client: options.client })
    }
  );
  if (outcome.status === 'stale') {
    rejected.stale += 1;
    return outcome;
  }
  // The queued job may have run under another caller's generation (coalesced requests
  // share one promise): echo this caller's generation, never the shared job's. The cached
  // result carries no generation — generation is never part of the cache key — so the
  // spread below cannot leak one generation into another caller's view.
  const result =
    options.generation === undefined
      ? outcome.result
      : { ...outcome.result, generation: options.generation };
  return { status: 'ready', result, coalesced: outcome.coalesced };
}

export interface CompositionStats {
  version: 1;
  /** The configured admission limits this server enforces. */
  limits: CompositionLimits;
  caches: {
    models: CacheSnapshot;
    layouts: CacheSnapshot;
    composed: CacheSnapshot;
  };
  queue: JobsSnapshot;
  /** Work refused since the last reset: superseded generations and over-limit compositions. */
  rejected: { stale: number; overLimit: number };
}

/**
 * Instrumentation for `GET /api/composition/stats` and `fractal composition-stats`: cache
 * hits/misses/entries/bytes/evictions, queue/jobs counts, rejected work and the
 * configured limits. The bench agent reads this shape.
 */
export function getCompositionStats(): CompositionStats {
  syncServerCachePool();
  return {
    version: 1,
    limits: effectiveLimits({}),
    caches: {
      models: modelCacheStats(),
      layouts: renderCacheStats(),
      composed: compositionCacheStats()
    },
    queue: compositionWorkQueue.snapshot(),
    rejected: { ...rejected }
  };
}

/**
 * Reset every composition bound: parsed models, layouts, composed results, rejected-work
 * counters, service-limit parsing and queue generations. The one call tests need before
 * asserting cache or counter state. Only reset when the queue is idle: queued waiters
 * are not resumed.
 */
export function resetCompositionState(): void {
  clearCompositionCache();
  clearModelCache();
  clearRenderCache();
  resetCompositionQueue();
  envLimitsCache = new WeakMap();
  rejected.stale = 0;
  rejected.overLimit = 0;
}

async function participatingSnapshots(
  root: string | ProjectSnapshot,
  state: CompositionState,
  options: CatalogOptions
): Promise<Map<string, ProjectSnapshot>> {
  const snapshots = new Map<string, ProjectSnapshot>();
  if (typeof root !== 'string') snapshots.set(root.id, root);
  const resolver = catalogResolver(options);
  for (const project of state.projects) {
    if (snapshots.has(project.model)) continue;
    const outcome = await resolver.resolve(project.model);
    if (outcome.status === 'resolved') snapshots.set(project.model, outcome.snapshot);
  }
  return snapshots;
}

/**
 * Qualified inspection over a composition. Only participating projects are inspected.
 * The selection arrives as raw JSON (the CLI's `--selection` flag): it runs through
 * the state parser's selection rules, so a malformed selection is a contract
 * diagnostic with a path, never a cast. Re-parsing the just-composed state also
 * checks owner participation against the actual member list.
 */
export async function inspectInComposition(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  selection: unknown,
  options: CompositionRequest = {}
): Promise<QualifiedInspection> {
  const { state, composed } = await composeFromSelector(root, selector, options);
  const parsed = parseCompositionState({ ...state, selection });
  if (parsed.selection === undefined)
    throw new CompositionUsageError('inspect with --composition requires --selection JSON');
  return inspectQualified(
    composed,
    await participatingSnapshots(root, state, options),
    parsed.selection
  );
}

/**
 * Search a composition through the shared core scorer. Only participating projects are
 * searched, and only through already-loaded snapshots: an unopened link's target is never
 * loaded to answer a query — the authored link title, ID and target model appear as a
 * `link` result instead. Every hit carries the qualified selection an inspector consumes
 * and a reveal hint that mounts the hit before restoring focus.
 */
export async function searchInComposition(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  query: string,
  options: CompositionRequest = {}
): Promise<CompositionSearchResult[]> {
  const { state } = await composeFromSelector(root, selector, options);
  return searchComposition(await participatingSnapshots(root, state, options), state, query);
}

/** The `project` command's composition view: everything except per-project diagram geometry. */
export function composedProjectSummary(composed: ComposedDiagram) {
  const { projects, ...rest } = composed;
  return {
    ...rest,
    projects: projects.map(({ diagram, ...project }) => project)
  };
}
