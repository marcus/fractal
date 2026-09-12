/**
 * Pipeline stages the benchmark reports.
 *
 * `measure` has no timing of its own today: the ELK adapter projects, measures, places and
 * assembles inside one call, so its cost is inside `layout`. It is reported once the layout
 * seam lands (see docs/plans/active/layout-performance-and-engines.md), and until then the
 * stage is simply absent from a row rather than reported as zero.
 */
export const BENCH_STAGES = ['load', 'project', 'measure', 'layout', 'svg', 'sequence'] as const;
export type BenchStage = (typeof BENCH_STAGES)[number];

/** Stages that carry a timing today. */
export const TIMED_BENCH_STAGES: readonly BenchStage[] = BENCH_STAGES.filter(
  (stage) => stage !== 'measure'
);

/**
 * Layout engines the benchmark can ask for. One engine exists; the registry that replaces this
 * list arrives with the layout seam, and the benchmark reads it then.
 */
export const BENCH_ENGINES = ['elk-layered'] as const;
export type BenchEngineId = (typeof BENCH_ENGINES)[number];

export function isBenchEngineId(value: string): value is BenchEngineId {
  return (BENCH_ENGINES as readonly string[]).includes(value);
}

export interface StageStats {
  p50: number;
  p95: number;
  samples: number;
}

export interface QualityMetrics {
  /** Segment pairs from different edges that properly cross. */
  crossings: number;
  /** Interior polyline points that change direction. */
  bends: number;
  /** Sum of every edge polyline's length. */
  edgeLength: number;
  area: number;
  aspectRatio: number;
}

/** One measured model, view and engine. Rows are the unit written to JSONL and compared. */
export interface BenchRow {
  model: string;
  view: string;
  engine: BenchEngineId;
  /** The directory the model was read from, or `synthetic` for a generated model. */
  source: string;
  nodes: number;
  edges: number;
  width: number;
  height: number;
  iterations: number;
  stages: Partial<Record<BenchStage, StageStats>>;
  fingerprint: string;
  quality: QualityMetrics;
  commit: string | null;
  timestamp: string;
}
