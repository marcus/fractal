import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compose } from '../composition/compose';
import { inspectQualified, type QualifiedInspection } from '../composition/inspect';
import { parseCompositionState } from '../composition/parse';
import type { ProjectSnapshot, ResolutionOutcome, SnapshotResolver } from '../composition/snapshot';
import { rootState, stateFromComposition } from '../composition/state';
import type {
  ComposedDiagram,
  CompositionDiagnostic,
  CompositionState,
  ProjectLinks,
  QualifiedSelection
} from '../composition/types';
import type { LayoutEngineId, Model, Status, ThemeId } from '../core/types';
import { searchModel } from '../core/search';
import { createCache } from './cache';
import {
  catalogResolver,
  loadModel,
  resolveProject,
  snapshotOf,
  type CatalogOptions
} from './models';

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
  /** Decoded explicit resolved state; mutually exclusive with `composition`. */
  state?: unknown;
  scene?: string;
  theme?: ThemeId;
  layout?: LayoutEngineId;
}

export interface CompositionResult {
  state: CompositionState;
  composed: ComposedDiagram;
  revisions: Record<string, string>;
}

export interface QualifiedSearchResult {
  model: string;
  source: 'model' | 'link';
  type: 'element' | 'relationship' | 'scene' | 'link';
  id: string;
  title: string;
  description: string;
  status?: Status;
  /** For a link metadata result, the model that authored the link. */
  owner?: string;
  target?: { model: string; scene?: string };
}

const COMPOSITION_CACHE_LIMIT = 64;
const composedCache = createCache<CompositionResult>(COMPOSITION_CACHE_LIMIT);

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

export interface RevisionConflict {
  code: 'revision_changed';
  model: string;
  error: string;
}

/**
 * Compare a client's revision vector with the revisions of the projects that were just loaded.
 * Only participating models can conflict; an entry for a model this composition never loaded is
 * ignored. Models are checked in sorted order so the first conflict is deterministic.
 */
export function revisionConflict(
  current: Record<string, string>,
  requested: Record<string, string>
): RevisionConflict | undefined {
  for (const model of Object.keys(requested).sort(compare)) {
    const revision = current[model];
    if (revision !== undefined && revision !== requested[model])
      return {
        code: 'revision_changed',
        model,
        error: `${model} changed on disk. Reload the composition before continuing.`
      };
  }
  return undefined;
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
 * Strict linked validation: local syntax, `from` and local endpoints, then the declared link
 * closure resolved with a visited set. A target's own links are followed only once it resolves.
 * Unresolved claims are diagnostics, never throws; only an unknown root or a malformed root model
 * fails the call. Exceeding the model traversal budget adds one `budget_exceeded` diagnostic.
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
    diagnostics.push(...localDiagnostics(owner, snapshots));
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

async function loadRootSnapshot(model: string, options: CatalogOptions): Promise<ProjectSnapshot> {
  const outcome = await catalogResolver(options).resolve(model);
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
  options: CatalogOptions
): Promise<void> {
  const resolver = catalogResolver(options);
  for (const model of models) {
    if (!outcomes.has(model)) outcomes.set(model, await resolver.resolve(model));
  }
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
 */
export async function composeFromSelector(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  options: CatalogOptions = {}
): Promise<CompositionResult> {
  const explicitState = selector.state !== undefined || selector.stateFile !== undefined;
  if (selector.composition !== undefined && explicitState)
    throw new CompositionUsageError(
      '--composition and an explicit composition state are mutually exclusive'
    );
  if (selector.state !== undefined && selector.stateFile !== undefined)
    throw new CompositionUsageError('composition state and state file are mutually exclusive');

  const rootSnapshot = typeof root === 'string' ? await loadRootSnapshot(root, options) : root;
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
      options
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
    state = parseCompositionState(raw);
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
    options
  );
  const revisions = revisionVector(state, outcomes);
  const key = compositionKey(state, revisions);
  const cached = composedCache.get(key);
  if (cached) return structuredClone(cached);

  const composed = await compose(replayResolver(outcomes), state);
  const result: CompositionResult = { state, composed, revisions };
  composedCache.set(key, structuredClone(result));
  return result;
}

/** Forget every composed result. Tests use this to start from a cold cache. */
export function clearCompositionCache(): void {
  composedCache.clear();
}

/** Compositions computed and reused since the last clear. A test seam, not a metric. */
export function compositionCacheStats(): { hits: number; misses: number; size: number } {
  return { ...composedCache.stats, size: composedCache.size };
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

/** Qualified inspection over a composition. Only participating projects are inspected. */
export async function inspectInComposition(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  selection: QualifiedSelection,
  options: CatalogOptions = {}
): Promise<QualifiedInspection> {
  const { state, composed } = await composeFromSelector(root, selector, options);
  return inspectQualified(composed, await participatingSnapshots(root, state, options), selection);
}

function matchesLink(
  link: { id: string; title: string; target: { model: string } },
  query: string
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [link.id, link.title, link.target.model].some((value) =>
    value.toLocaleLowerCase().includes(needle)
  );
}

/**
 * Search every participating project and qualify each hit with its model. Unopened link targets
 * are never searched; their authored link titles appear as link metadata results instead.
 * Ordering is deterministic: projects in state order, model hits in search order, then links.
 */
export async function searchInComposition(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  query: string,
  options: CatalogOptions = {}
): Promise<QualifiedSearchResult[]> {
  const { state, composed } = await composeFromSelector(root, selector, options);
  const participating = new Set(state.projects.map((project) => project.model));
  const snapshots = await participatingSnapshots(root, state, options);
  const results: QualifiedSearchResult[] = [];
  for (const project of state.projects) {
    const snapshot = snapshots.get(project.model);
    if (!snapshot) continue;
    for (const entry of searchModel(snapshot.model, query))
      results.push({ model: project.model, source: 'model', ...entry });
  }
  for (const project of state.projects) {
    const snapshot = snapshots.get(project.model);
    if (!snapshot?.links) continue;
    for (const link of snapshot.links.links) {
      if (participating.has(link.target.model)) continue;
      if (!matchesLink(link, query)) continue;
      results.push({
        model: link.target.model,
        source: 'link',
        type: 'link',
        id: link.id,
        title: link.title,
        description: `${project.model} → ${link.target.model}`,
        owner: project.model,
        target: {
          model: link.target.model,
          ...(link.target.scene === undefined ? {} : { scene: link.target.scene })
        }
      });
    }
  }
  return results;
}

/** The `project` command's composition view: everything except per-project diagram geometry. */
export function composedProjectSummary(composed: ComposedDiagram) {
  const { projects, ...rest } = composed;
  return {
    ...rest,
    projects: projects.map(({ diagram, ...project }) => project)
  };
}
