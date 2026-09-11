import { performance } from 'node:perf_hooks';
import { layout } from '../adapters/elk-layout';
import { project } from '../core/projection';
import { exportSvg } from '../core/svg';
import { layoutSequence } from '../sequence/layout';
import type { SequenceJourney } from '../sequence/types';
import type { Diagram, Model, ViewState } from '../core/types';
import { TIMED_BENCH_STAGES, type BenchEngineId, type BenchStage, type StageStats } from './types';

export interface LoadedBenchModel {
  model: Model;
  sequences: readonly SequenceJourney[];
}

/**
 * One measurable unit of work: a model source, a resolved view state, and the engine to place
 * it with. `load` is re-run every iteration, because re-reading and re-parsing the model is
 * what the studio does on every request today and is the stage worth watching.
 */
export interface BenchSubject {
  load: () => Promise<LoadedBenchModel>;
  state: ViewState;
  engine: BenchEngineId;
  title?: string;
  subtitle?: string;
}

/**
 * Placement per engine id. One entry today; the layout-engine registry replaces this map when
 * the seam lands, without changing what the benchmark measures.
 */
const ENGINES: Record<BenchEngineId, (model: Model, state: ViewState) => Promise<Diagram>> = {
  'elk-layered': layout
};

export interface StageRun {
  durations: Partial<Record<BenchStage, number>>;
  diagram: Diagram;
  nodes: number;
  edges: number;
}

/**
 * One pass over the pipeline. `project` is timed on its own; `layout` is the whole engine call,
 * which still projects, measures, places and assembles internally until the seam splits it.
 */
export async function runStages(subject: BenchSubject): Promise<StageRun> {
  const engine = ENGINES[subject.engine];
  if (!engine) throw new Error(`Unknown layout engine: ${subject.engine}`);
  const durations: Partial<Record<BenchStage, number>> = {};

  const loadStart = performance.now();
  const { model, sequences } = await subject.load();
  durations.load = performance.now() - loadStart;

  const projectStart = performance.now();
  const projection = project(model, subject.state);
  durations.project = performance.now() - projectStart;

  const layoutStart = performance.now();
  const diagram = await engine(model, subject.state);
  durations.layout = performance.now() - layoutStart;

  const svgStart = performance.now();
  exportSvg(model, diagram, { title: subject.title, subtitle: subject.subtitle });
  durations.svg = performance.now() - svgStart;

  if (sequences.length) {
    const sequenceStart = performance.now();
    for (const journey of sequences)
      layoutSequence(journey, {
        collapsedPhases: [],
        collapsedGroups: [],
        hiddenParticipants: [],
        ...(subject.state.theme !== undefined ? { theme: subject.state.theme } : {})
      });
    durations.sequence = performance.now() - sequenceStart;
  }
  return {
    durations,
    diagram,
    nodes: projection.elements.length,
    edges: projection.edges.length
  };
}

/** Nearest-rank percentile over a sorted copy; small sample counts stay honest this way. */
export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function summarize(runs: readonly StageRun[]): Partial<Record<BenchStage, StageStats>> {
  const stages: Partial<Record<BenchStage, StageStats>> = {};
  for (const stage of TIMED_BENCH_STAGES) {
    const samples = runs
      .map((run) => run.durations[stage])
      .filter((value): value is number => value !== undefined);
    if (!samples.length) continue;
    stages[stage] = {
      p50: round(percentile(samples, 0.5)),
      p95: round(percentile(samples, 0.95)),
      samples: samples.length
    };
  }
  return stages;
}

export interface MeasuredSubject {
  stages: Partial<Record<BenchStage, StageStats>>;
  diagram: Diagram;
  nodes: number;
  edges: number;
}

/** One discarded warm-up run, then `iterations` measured runs. */
export async function measureSubject(
  subject: BenchSubject,
  iterations: number
): Promise<MeasuredSubject> {
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new Error('Iterations must be a whole number of at least 1');
  await runStages(subject);
  const runs: StageRun[] = [];
  for (let i = 0; i < iterations; i++) runs.push(await runStages(subject));
  const last = runs[runs.length - 1];
  return { stages: summarize(runs), diagram: last.diagram, nodes: last.nodes, edges: last.edges };
}
