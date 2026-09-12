import { LAYOUT_ENGINES, isLayoutEngineId } from '../core/layout-engines';
import type { LayoutEngineId } from '../core/types';

/**
 * Pipeline stages the benchmark reports: read and parse, project the view, measure node content,
 * place it and assemble the diagram, export SVG, and lay out sequence journeys when present.
 * `sequence` is absent from a row when the model has no journeys.
 */
export const BENCH_STAGES = ['load', 'project', 'measure', 'layout', 'svg', 'sequence'] as const;
export type BenchStage = (typeof BENCH_STAGES)[number];

/** Every stage carries a timing; kept for callers that iterate reported stages. */
export const TIMED_BENCH_STAGES: readonly BenchStage[] = BENCH_STAGES;

/** Layout engines the benchmark can ask for: the shared registry, in its order. */
export const BENCH_ENGINES: readonly LayoutEngineId[] = LAYOUT_ENGINES.map((engine) => engine.id);
export type BenchEngineId = LayoutEngineId;

export function isBenchEngineId(value: string): value is BenchEngineId {
  return isLayoutEngineId(value);
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
