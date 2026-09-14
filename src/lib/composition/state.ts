import type { LayoutEngineId, Model, Scene, ThemeId } from '../core/types';
import { parseCompositionState } from './parse';
import type { CompositionState, ProjectViewState, QualifiedSelection } from './types';
import type { ProjectSnapshot } from './snapshot';

/**
 * Composition state helpers. Scenes supply semantic view defaults; an explicit saved view remains
 * authoritative when replaying state. Every transition validates through the phase 0 parser so an
 * invalid result is never returned, and every call returns fresh records.
 */

const EMPTY_VIEW: ProjectViewState = { expanded: [], proposed: false, lens: 'structure' };

function viewOf(scene: Scene): ProjectViewState {
  return {
    expanded: [...scene.expanded],
    proposed: scene.proposed,
    lens: scene.lens,
    ...(scene.scope === undefined ? {} : { scope: scene.scope })
  };
}

/** The named scene, or the first when omitted. The message names the scene so compose can convert it. */
export function sceneView(
  model: Model,
  sceneId?: string
): { scene: Scene; view: ProjectViewState } {
  const scene =
    sceneId === undefined
      ? model.scenes[0]
      : model.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`Unknown scene: ${sceneId ?? '(none)'} in model ${model.id}`);
  return { scene, view: viewOf(scene) };
}

/** Root-only state: open, view from the scene, presentation from options, the scene, or the defaults. */
export function rootState(
  root: ProjectSnapshot,
  options: { scene?: string; theme?: ThemeId; layout?: LayoutEngineId } = {}
): CompositionState {
  const { scene, view } = sceneView(root.model, options.scene);
  return parseCompositionState({
    version: 1,
    root: root.id,
    projects: [{ model: root.id, scene: scene.id, mode: 'open', view }],
    theme: options.theme ?? scene.theme ?? 'grove',
    layout: options.layout ?? scene.layout ?? 'elk-layered'
  });
}

/** Resolve an authored composition's foreign projects, in authored order after the root. */
export function stateFromComposition(
  root: ProjectSnapshot,
  compositionId: string,
  lookup: (model: string) => ProjectSnapshot | undefined
): CompositionState {
  const composition = root.links?.compositions.find((candidate) => candidate.id === compositionId);
  if (!composition) throw new Error(`Unknown composition: ${compositionId}`);
  const { scene: rootScene, view: rootView } = sceneView(root.model, composition.rootScene);
  const projects: CompositionState['projects'] = [
    { model: root.id, scene: rootScene.id, mode: 'open', view: rootView },
    ...composition.projects.map((entry) => {
      const snapshot = lookup(entry.model);
      if (!snapshot)
        return {
          model: entry.model,
          ...(entry.scene === undefined ? {} : { scene: entry.scene }),
          mode: entry.mode,
          view: { ...EMPTY_VIEW, expanded: [] }
        };
      const requested =
        entry.scene === undefined
          ? undefined
          : snapshot.model.scenes.find((scene) => scene.id === entry.scene);
      const chosen = requested ?? snapshot.model.scenes[0];
      if (!chosen) throw new Error(`Model ${entry.model} declares no scenes`);
      return {
        model: entry.model,
        scene: entry.scene ?? chosen.id,
        mode: entry.mode,
        view: viewOf(chosen)
      };
    })
  ];
  return parseCompositionState({
    version: 1,
    root: root.id,
    composition: compositionId,
    projects,
    theme: rootScene.theme ?? 'grove',
    layout: rootScene.layout ?? 'elk-layered'
  });
}

function selectionOwner(selection: QualifiedSelection): string {
  return selection.kind === 'connection' ? selection.ownerModel : selection.model;
}

/** Append an open project. A project already present is returned unchanged (a fresh record). */
export function openProject(
  state: CompositionState,
  snapshot: ProjectSnapshot,
  scene?: string
): CompositionState {
  if (state.projects.some((project) => project.model === snapshot.id))
    return parseCompositionState(state);
  const { scene: chosen, view } = sceneView(snapshot.model, scene);
  return parseCompositionState({
    ...state,
    projects: [...state.projects, { model: snapshot.id, scene: chosen.id, mode: 'open', view }]
  });
}

/** Remove a non-root project and clear a selection or focus that referred to it. */
export function closeProject(state: CompositionState, model: string): CompositionState {
  if (model === state.root) throw new Error('The root project cannot be closed');
  const projects = state.projects.filter((project) => project.model !== model);
  const selection =
    state.selection && selectionOwner(state.selection) === model ? undefined : state.selection;
  const focusedProject = state.focusedProject === model ? undefined : state.focusedProject;
  return parseCompositionState({
    ...state,
    projects,
    selection,
    focusedProject
  });
}

/** Change one participating project's open/collapsed mode. */
export function setProjectMode(
  state: CompositionState,
  model: string,
  mode: 'open' | 'collapsed'
): CompositionState {
  if (!state.projects.some((project) => project.model === model))
    throw new Error(`Unknown project: ${model}`);
  return parseCompositionState({
    ...state,
    projects: state.projects.map((project) =>
      project.model === model ? { ...project, mode } : project
    )
  });
}
