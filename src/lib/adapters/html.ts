import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './elk-layout';
import { portableHtml } from '../portable/document';
import type { Diagram, Model, ViewState } from '../core/types';
import type { SequenceJourney } from '../sequence/types';

let assets: Promise<{ js: string; css: string; notices?: string }> | undefined;

export async function exportHtml(
  model: Model,
  options: {
    state: ViewState;
    scene?: string;
    sequences?: SequenceJourney[];
    assets?: { js: string; css: string; notices?: string };
    /**
     * Where the geometry comes from. The default lays the view out here; a server that already
     * has this view laid out passes its own source so the export reuses it. Called only after the
     * scene is known to exist, so validation still reports the scene first.
     */
    diagram?: () => Promise<Diagram>;
  }
): Promise<string> {
  const scene = options.scene ?? model.scenes[0]?.id;
  if (!scene || !model.scenes.some((item) => item.id === scene))
    throw new Error(`Unknown scene: ${scene}`);
  const diagram = await (options.diagram ?? (() => layout(model, options.state)))();
  if (!options.assets)
    assets ??= readFile(resolve('build/portable.json'), 'utf8')
      .then((text) => JSON.parse(text) as { js: string; css: string; notices?: string })
      .catch((error) => {
        assets = undefined;
        throw error;
      });
  const viewer = options.assets ?? (await assets)!;
  return portableHtml(
    {
      version: 1,
      model,
      sequences: options.sequences ?? [],
      scene,
      view: options.state,
      diagram,
      licenses: viewer.notices
    },
    viewer
  );
}
