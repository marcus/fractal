import type { Scene, ViewState } from './types';

/**
 * The optional presentation fields a scene carries into a view, present only when authored so a
 * scene that never set them produces exactly the view it always did. Every surface that turns a
 * scene into a view state spreads this rather than naming the fields itself.
 */
export function sceneOptions(scene: Scene): Pick<ViewState, 'edges' | 'context' | 'hide'> {
  return {
    ...(scene.hide ? { hide: [...scene.hide] } : {}),
    ...(scene.edges ? { edges: scene.edges } : {}),
    ...(scene.context ? { context: scene.context } : {})
  };
}
