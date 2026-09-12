import { getLayoutEngineInfo, LAYOUT_ENGINES } from '../../core/layout-engines';
import type { LayoutEngine } from '../../core/layout-engine';
import type { LayoutEngineId } from '../../core/types';
import { elkLayeredEngine } from './elk';

/**
 * Engine implementations, one per registered id. Registering an engine is one entry here plus
 * its metadata in `core/layout-engines.ts`; nothing else in the application changes.
 */
const implementations: Record<LayoutEngineId, () => LayoutEngine> = {
  'elk-layered': () =>
    elkLayeredEngine({ ...getLayoutEngineInfo('elk-layered'), direction: 'right' }),
  'elk-layered-down': () =>
    elkLayeredEngine({ ...getLayoutEngineInfo('elk-layered-down'), direction: 'down' })
};

const instances = new Map<LayoutEngineId, LayoutEngine>();

/** The engine for an id, or the default when none is given. Unknown ids fail like unknown themes. */
export function getLayoutEngine(id?: string): LayoutEngine {
  const info = getLayoutEngineInfo(id);
  let engine = instances.get(info.id);
  if (!engine) {
    engine = implementations[info.id]();
    instances.set(info.id, engine);
  }
  return engine;
}

/** Every registered engine, instantiated, in registry order. */
export function allLayoutEngines(): LayoutEngine[] {
  return LAYOUT_ENGINES.map((info) => getLayoutEngine(info.id));
}
