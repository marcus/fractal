import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './elk-layout';
import { portableHtml } from '../portable/document';
import type { Model, ViewState } from '../core/types';
import type { SequenceJourney } from '../sequence/types';

let assets: Promise<{ js: string; css: string; notices?: string }> | undefined;

export async function exportHtml(
  model: Model,
  options: {
    state: ViewState;
    scene?: string;
    sequences?: SequenceJourney[];
    assets?: { js: string; css: string; notices?: string };
  }
): Promise<string> {
  const scene = options.scene ?? model.scenes[0]?.id;
  if (!scene || !model.scenes.some((item) => item.id === scene))
    throw new Error(`Unknown scene: ${scene}`);
  const diagram = await layout(model, options.state);
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
