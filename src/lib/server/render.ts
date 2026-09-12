import { layout } from '../core/layout';
import { createCache } from './cache';
import type { Diagram, Model, ViewState } from '../core/types';

/** What a cached render needs from a loaded model: the geometry source and its content hash. */
export interface RenderableModel {
  model: Model;
  revision: string;
}

const LAYOUT_CACHE_LIMIT = 64;
const diagrams = createCache<Diagram>(LAYOUT_CACHE_LIMIT);

/**
 * A stable string for any JSON-shaped value: object keys in sorted order, undefined dropped so an
 * absent field and an explicit `undefined` agree. Every field of the view state takes part, so a
 * field added to `ViewState` later joins the key on its own rather than being silently ignored.
 */
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
 * The identity of a rendered view: the content hash of the model plus the view state that produced
 * it. `expanded` is a set, not a sequence, so it is sorted — collapsing what was just expanded, or
 * following a link that lists the same components in another order, is the same diagram.
 */
export function renderKey(revision: string, state: ViewState): string {
  const expanded = Array.isArray(state.expanded) ? [...state.expanded].sort() : state.expanded;
  return `${revision}\0${canonical({ ...state, expanded })}`;
}

/**
 * Lay a view out, reusing an identical earlier layout.
 *
 * The layout itself stays a pure function of model and state; caching is a server concern, so the
 * CLI, the tests and the portable viewer keep calling `layout` directly and always compute fresh
 * geometry.
 *
 * A hit is handed a `structuredClone` rather than the stored diagram. Deep-freezing the entry
 * would be cheaper per hit, but a layout node is a shallow spread of a model element, so freezing
 * a diagram would reach into objects the parsed-model cache owns and make an unrelated caller
 * throw. Cloning keeps the two caches independent and gives every caller exactly what a fresh
 * layout would have given it — a private value, safe to mutate — for well under a millisecond
 * against the tens of milliseconds a layout costs. The echoed `state` is rebuilt from the
 * caller's own state, so even the order of `expanded` matches a fresh layout.
 */
export async function renderDiagram(loaded: RenderableModel, state: ViewState): Promise<Diagram> {
  const key = renderKey(loaded.revision, state);
  const cached = diagrams.get(key);
  if (cached)
    return { ...structuredClone(cached), state: { ...state, expanded: [...state.expanded] } };
  const diagram = await layout(loaded.model, state);
  // The stored copy is private too, so nothing a caller does to the diagram it was handed can
  // reach the next reader.
  diagrams.set(key, structuredClone(diagram));
  return diagram;
}

/** Forget every laid-out view. Tests use this to start from a cold cache. */
export function clearRenderCache(): void {
  diagrams.clear();
}

/** Layouts skipped and layouts performed since the last clear. A test seam, not a metric. */
export function renderCacheStats(): { hits: number; misses: number; size: number } {
  return { ...diagrams.stats, size: diagrams.size };
}
