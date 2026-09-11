import { loadModel } from './models';
import { layoutSequence } from '../sequence/layout';
import type { SequenceViewState } from '../sequence/types';

/** One revision-bound sequence operation shared by HTTP geometry and export. */
export async function renderSequence(input: {
  model: string;
  journey: string;
  revision?: string;
  state?: SequenceViewState;
}) {
  const loaded = await loadModel(input.model);
  if (input.revision !== undefined && input.revision !== loaded.revision)
    throw new Error('The model changed on disk. Reload the journey before continuing.');
  const journey = loaded.sequences.find((item) => item.id === input.journey);
  if (!journey) throw new Error(`Unknown journey: ${input.journey}`);
  return { journey, diagram: layoutSequence(journey, input.state) };
}
