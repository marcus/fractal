import type { LayoutEngineId } from './types';
export type { LayoutEngineId } from './types';

/** What every surface needs to know about an engine without loading its implementation. */
export interface LayoutEngineInfo {
  readonly id: LayoutEngineId;
  readonly title: string;
  readonly description: string;
}

/**
 * The registry of layout engines, mirroring the theme registry: ids and copy live here so the
 * CLI, the studio and validation stay independent of the engine code, which the browser must not
 * bundle needlessly. Implementations are registered in `adapters/layout`.
 */
export const LAYOUT_ENGINES: readonly LayoutEngineInfo[] = Object.freeze([
  Object.freeze({
    id: 'elk-layered',
    title: 'Layered, left to right',
    description: 'ELK layered placement with orthogonal routing; the studio default.'
  }),
  Object.freeze({
    id: 'elk-layered-down',
    title: 'Top to bottom',
    description:
      'The same layered placement flowing downward, for tall viewports, portrait pages and README embeds.'
  })
]);

export const DEFAULT_LAYOUT_ENGINE: LayoutEngineId = 'elk-layered';

const byId = new Map(LAYOUT_ENGINES.map((engine) => [engine.id, engine]));

export function isLayoutEngineId(value: unknown): value is LayoutEngineId {
  return typeof value === 'string' && byId.has(value as LayoutEngineId);
}

/** Resolve engine metadata. An omitted engine is the default, so existing views keep their look. */
export function getLayoutEngineInfo(id?: string): LayoutEngineInfo {
  const requested = id ?? DEFAULT_LAYOUT_ENGINE;
  const engine = byId.get(requested as LayoutEngineId);
  if (!engine)
    throw new Error(
      `Unknown layout engine: ${requested}. Choose ${LAYOUT_ENGINES.map((item) => item.id).join(', ')}`
    );
  return engine;
}
