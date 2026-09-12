import { TIMED_BENCH_STAGES, type BenchRow, type BenchStage } from './types';

export interface StageDelta {
  stage: BenchStage;
  /** Milliseconds; absent when the stage is missing from one of the two runs. */
  baseline: number | null;
  current: number | null;
  delta: number | null;
}

export interface RowComparison {
  key: string;
  model: string;
  view: string;
  engine: string;
  /** `added` has no baseline row; `missing` was in the baseline and was not measured again. */
  status: 'compared' | 'added' | 'missing';
  fingerprintChanged: boolean;
  baselineFingerprint: string | null;
  fingerprint: string | null;
  stages: StageDelta[];
}

export interface BaselineComparison {
  rows: RowComparison[];
  /** True when any row measured in both runs has a different geometry fingerprint. */
  geometryChanged: boolean;
}

export function rowKey(row: Pick<BenchRow, 'model' | 'view' | 'engine'>): string {
  return `${row.model}::${row.view}::${row.engine}`;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Time deltas per stage and any fingerprint change, in current-run order then baseline leftovers. */
export function compareToBaseline(
  current: readonly BenchRow[],
  baseline: readonly BenchRow[]
): BaselineComparison {
  const baselineByKey = new Map(baseline.map((row) => [rowKey(row), row]));
  const rows: RowComparison[] = current.map((row) => {
    const previous = baselineByKey.get(rowKey(row));
    const stages: StageDelta[] = TIMED_BENCH_STAGES.flatMap((stage) => {
      const before = previous?.stages[stage]?.p50 ?? null;
      const after = row.stages[stage]?.p50 ?? null;
      if (before === null && after === null) return [];
      return [
        {
          stage,
          baseline: before,
          current: after,
          delta: before === null || after === null ? null : round(after - before)
        }
      ];
    });
    return {
      key: rowKey(row),
      model: row.model,
      view: row.view,
      engine: row.engine,
      status: previous ? 'compared' : 'added',
      fingerprintChanged: previous ? previous.fingerprint !== row.fingerprint : false,
      baselineFingerprint: previous?.fingerprint ?? null,
      fingerprint: row.fingerprint,
      stages
    };
  });
  const measured = new Set(current.map(rowKey));
  for (const row of baseline)
    if (!measured.has(rowKey(row)))
      rows.push({
        key: rowKey(row),
        model: row.model,
        view: row.view,
        engine: row.engine,
        status: 'missing',
        fingerprintChanged: false,
        baselineFingerprint: row.fingerprint,
        fingerprint: null,
        stages: []
      });
  return { rows, geometryChanged: rows.some((row) => row.fingerprintChanged) };
}

/** One row, or a document with a `rows` array; null when the text is not one JSON value. */
function readDocument(text: string): BenchRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed as BenchRow[];
  const rows = (parsed as { rows?: unknown }).rows;
  if (Array.isArray(rows)) return rows as BenchRow[];
  return [parsed as BenchRow];
}

/**
 * Read a baseline written by `--output` (JSONL, one row per line) or by `--json` (one document
 * with a `rows` array), so either recorded form can be compared against.
 */
export function parseBenchRows(text: string): BenchRow[] {
  const rows: BenchRow[] = [];
  const whole = readDocument(text);
  if (whole) rows.push(...whole);
  else
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      rows.push(...(readDocument(trimmed) ?? []));
    }
  for (const row of rows)
    if (!row || typeof row.model !== 'string' || typeof row.fingerprint !== 'string')
      throw new Error('Baseline rows need model, view, engine and fingerprint fields');
  return rows;
}
