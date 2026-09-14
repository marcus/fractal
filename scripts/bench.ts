#!/usr/bin/env node
// The layout benchmark's shell: resolves which models and views to measure, runs the core in
// src/lib/bench, and writes the table, JSON document or JSONL rows. All measurement logic lives
// in the library so a server or a test can run the same numbers.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  BENCH_ENGINES,
  TIMED_BENCH_STAGES,
  compareToBaseline,
  geometryFingerprint,
  isBenchEngineId,
  measureSubject,
  parseBenchRows,
  qualityMetrics,
  syntheticModel,
  type BenchEngineId,
  type BenchRow,
  type BenchStage,
  type BaselineComparison,
  type LoadedBenchModel
} from '../src/lib/bench';
import {
  COMPOSITION_STAGES,
  compareCompositionRows,
  fixtureDigest,
  generateFixtures,
  measureComposition,
  writeFixtures,
  type CompositionComparison,
  type CompositionRow
} from './bench-fixtures';
import { showAllStructure } from '../src/lib/core/navigation';
import { getCompositionStats } from '../src/lib/server/composition';
import { loadDirectory, resolveCatalog } from '../src/lib/server/models';
import type { Model, ViewState } from '../src/lib/core/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BENCH_HELP = `Fractal · layout benchmark

Usage: bin/fractal bench [options]

Times the model pipeline over a set of models and views, fingerprints the geometry it produced,
and reports composition quality. Deterministic order, no interaction, structured output.

Stages: load (read and parse), project, measure (node content), layout (the engine call and
assembly), svg, and sequence layout for models with journeys.

Composition mode (--composition) times linked compositions instead of single models. With no
value it generates the fixture matrix under a temporary catalog and removes it afterwards:
resolve, parse, local projection/measure/layout, frame placement, bridge routing and
serialization are timed separately, with counts, estimated bytes and a geometry fingerprint.
With a value it measures one local composition from --catalog and --model, so real repository
models are read only where they live and are never bundled.

Options:
  --catalog PATH                 Use a specific catalog.json instead of the resolved one
  --model ID[,ID]                Measure only these models (composition: the root model ID)
  --directory PATH[,PATH]        Measure these model directories instead of a catalog
  --synthetic N[,N]              Also measure generated models of N elements (alone: only these)
  --views scene|all|both         Authored scenes, show-all of the first scene, or both (default both)
  --engine ID[,ID]               Layout engines to compare (default all: ${BENCH_ENGINES.join(', ')})
  --composition [ID]             Measure the generated composition fixture matrix, or ID with
                                 --catalog/--model for a local steel thread
  --fixture ID[,ID]              Composition fixtures to generate (default all: see below)
  --iterations N                 Measured runs after one discarded warm-up (default 5)
  --json                         One JSON document on stdout
  --output FILE                  Write JSONL, one row per model, view and engine
  --baseline FILE                Compare against an earlier run and print deltas
  --fail-on-geometry-change      Exit nonzero when a fingerprint differs (needs --baseline)
  -h, --help                     Show this text

Composition fixtures: unopened, visible, loaded, bridges, chain, cycle, diamond, labels.

Examples:
  bin/fractal bench
  bin/fractal bench --model delivery --views scene --json
  bin/fractal bench --synthetic 60,240 --iterations 3
  bin/fractal bench --output artifacts/bench/today.jsonl
  bin/fractal bench --baseline artifacts/bench/baseline.jsonl --fail-on-geometry-change
  bin/fractal bench --composition --iterations 1 --json
  bin/fractal bench --composition plugins --catalog /tmp/catalog.json --model sidecar --json`;

interface BenchSource {
  id: string;
  source: string;
  load: () => Promise<LoadedBenchModel>;
}

interface BenchView {
  id: string;
  state: ViewState;
  title: string;
  subtitle: string;
}

const list = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

function gitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

/** Directories under the bundled examples, so a run always has a model that ships with Fractal. */
async function bundledExamples(): Promise<string[]> {
  const root = join(ROOT, 'examples');
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort();
}

/** The resolved catalog plus the bundled examples, deduped by directory, in a stable order. */
async function resolveSources(values: {
  catalog?: string;
  model?: string;
  directory?: string;
  synthetic?: string;
}): Promise<BenchSource[]> {
  const sizes = list(values.synthetic).map((value) => {
    const size = Number(value);
    if (!Number.isInteger(size) || size < 3)
      throw new Error(`Synthetic size must be a whole number of at least 3: ${value}`);
    return size;
  });
  const synthetic: BenchSource[] = sizes.map((size) => ({
    id: `synthetic-${size}`,
    source: 'synthetic',
    load: async () => ({ model: syntheticModel(size), sequences: [] })
  }));
  const narrowed =
    values.catalog !== undefined || values.model !== undefined || values.directory !== undefined;
  // `--synthetic` on its own measures only generated models; alongside a narrowing flag it adds to them.
  if (sizes.length && !narrowed) return synthetic;

  const ids = list(values.model);
  const explicit = list(values.directory).map((path) => resolve(path));
  const candidates = explicit.length
    ? explicit.map((directory) => ({ id: null, directory }))
    : [
        ...(await resolveCatalog({ catalog: values.catalog })).projects.map((project) => ({
          id: project.id as string | null,
          directory: resolve(project.directory)
        })),
        ...(await bundledExamples()).map((directory) => ({
          id: basename(directory) as string | null,
          directory
        }))
      ];
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.directory)) return false;
    seen.add(candidate.directory);
    return true;
  });
  // A named model is chosen by its catalog identity before anything is parsed, so a narrowed run
  // never reads the rest of the catalog and one unrelated broken model cannot fail it.
  const chosen = ids.length
    ? unique.filter((candidate) => candidate.id === null || ids.includes(candidate.id))
    : unique;
  for (const id of ids)
    if (!explicit.length && !chosen.some((candidate) => candidate.id === id))
      throw new Error(`Unknown model: ${id}`);

  const sources: BenchSource[] = [];
  for (const { directory } of chosen) {
    const { model } = await loadDirectory(directory);
    sources.push({ id: model.id, source: directory, load: () => loadDirectory(directory) });
  }
  const selected = ids.length ? sources.filter((source) => ids.includes(source.id)) : sources;
  for (const id of ids)
    if (!selected.some((source) => source.id === id)) throw new Error(`Unknown model: ${id}`);
  return [...selected, ...synthetic];
}

function sceneState(model: Model, index: number): ViewState {
  const scene = model.scenes[index];
  return {
    expanded: [...scene.expanded],
    proposed: scene.proposed,
    lens: scene.lens,
    ...(scene.scope !== undefined ? { scope: scene.scope } : {}),
    ...(scene.theme !== undefined ? { theme: scene.theme } : {})
  };
}

function viewsFor(model: Model, mode: 'scene' | 'all' | 'both'): BenchView[] {
  if (!model.scenes.length) throw new Error(`Model has no scenes: ${model.id}`);
  const views: BenchView[] = [];
  if (mode !== 'all')
    views.push(
      ...model.scenes.map((scene, index) => ({
        id: scene.id,
        state: sceneState(model, index),
        title: `${model.title} / ${scene.title}`,
        subtitle: scene.description
      }))
    );
  if (mode !== 'scene')
    views.push({
      id: 'show-all',
      state: showAllStructure(model, sceneState(model, 0)),
      title: `${model.title} / ${model.scenes[0].title}`,
      subtitle: model.scenes[0].description
    });
  return views;
}

function pad(value: string, width: number, align: 'left' | 'right'): string {
  return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

function table(headers: string[], rows: string[][], align: ('left' | 'right')[]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => pad(cell, widths[column], align[column]))
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n'
  );
}

const ms = (value: number | undefined): string => (value === undefined ? '-' : value.toFixed(2));

function renderRows(rows: readonly BenchRow[]): string {
  const stages = TIMED_BENCH_STAGES.filter((stage) =>
    rows.some((row) => row.stages[stage] !== undefined)
  );
  const headers = [
    'Model',
    'View',
    'Engine',
    'Nodes',
    'Edges',
    ...stages.map((stage) => `${stage} p50`),
    'Cross',
    'Bends',
    'Fingerprint'
  ];
  const align: ('left' | 'right')[] = [
    'left',
    'left',
    'left',
    'right',
    'right',
    ...stages.map(() => 'right' as const),
    'right',
    'right',
    'left'
  ];
  const body = rows.map((row) => [
    row.model,
    row.view,
    row.engine,
    String(row.nodes),
    String(row.edges),
    ...stages.map((stage) => ms(row.stages[stage]?.p50)),
    String(row.quality.crossings),
    String(row.quality.bends),
    row.fingerprint.slice(0, 12)
  ]);
  return table(headers, body, align);
}

function renderComparison(comparison: BaselineComparison, path: string): string {
  const stages: BenchStage[] = TIMED_BENCH_STAGES.filter((stage) =>
    comparison.rows.some((row) => row.stages.some((delta) => delta.stage === stage))
  );
  const headers = [
    'Model',
    'View',
    'Engine',
    ...stages.map((stage) => `${stage} Δ`),
    'Geometry',
    'Status'
  ];
  const align: ('left' | 'right')[] = [
    'left',
    'left',
    'left',
    ...stages.map(() => 'right' as const),
    'left',
    'left'
  ];
  const signed = (value: number | null): string => {
    if (value === null) return '-';
    const magnitude = Math.abs(value).toFixed(2);
    return magnitude === '0.00' ? magnitude : `${value > 0 ? '+' : '-'}${magnitude}`;
  };
  const body = comparison.rows.map((row) => [
    row.model,
    row.view,
    row.engine,
    ...stages.map((stage) =>
      signed(row.stages.find((delta) => delta.stage === stage)?.delta ?? null)
    ),
    row.status === 'compared' ? (row.fingerprintChanged ? 'CHANGED' : 'same') : '-',
    row.status
  ]);
  return [`Baseline ${path}`, table(headers, body, align)].join('\n');
}

interface CompositionArg {
  /** Bare `--composition`: measure the generated fixture matrix. */
  matrix: boolean;
  /** `--composition ID`: measure one local composition through --catalog and --model. */
  real?: string;
}

/**
 * `--composition` is both a mode switch and, with a value, a local composition selector. Node's
 * argument parser cannot express an optional value, so pull it out before parsing: a following
 * token that is not another flag is the authored composition ID, otherwise it is the matrix mode.
 */
function extractComposition(argv: string[]): { args: string[]; composition: CompositionArg } {
  const args: string[] = [];
  let matrix = false;
  let real: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--composition') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        real = next;
        i++;
      } else matrix = true;
    } else if (token.startsWith('--composition=')) {
      real = token.slice('--composition='.length);
    } else args.push(token);
  }
  return { args, composition: { matrix, ...(real === undefined ? {} : { real }) } };
}

function renderCompositionRows(rows: readonly CompositionRow[]): string {
  const stages = COMPOSITION_STAGES.filter((stage) =>
    rows.some((row) => row.stages[stage] !== undefined)
  );
  const headers = [
    'Fixture',
    'Engine',
    'Projects',
    'Loaded',
    'Nodes',
    'Edges',
    'Bridges',
    'Stubs',
    'Bytes',
    ...stages.map((stage) => `${stage} p50`),
    'Fingerprint'
  ];
  const align: ('left' | 'right')[] = [
    'left',
    'left',
    ...['Projects', 'Loaded', 'Nodes', 'Edges', 'Bridges', 'Stubs', 'Bytes'].map(
      () => 'right' as const
    ),
    ...stages.map(() => 'right' as const),
    'left'
  ];
  const body = rows.map((row) => [
    row.model,
    row.engine,
    String(row.counts.projects),
    String(row.counts.loadedElements),
    String(row.nodes),
    String(row.edges),
    String(row.counts.bridges),
    String(row.counts.stubs),
    String(row.bytes),
    ...stages.map((stage) => ms(row.stages[stage]?.p50)),
    row.fingerprint.slice(0, 12)
  ]);
  return table(headers, body, align);
}

function renderCompositionComparison(comparison: CompositionComparison, path: string): string {
  const stages = COMPOSITION_STAGES.filter((stage) =>
    comparison.rows.some((row) => row.stages.some((delta) => delta.stage === stage))
  );
  const headers = [
    'Fixture',
    'Engine',
    ...stages.map((stage) => `${stage} Δ`),
    'Geometry',
    'Status'
  ];
  const align: ('left' | 'right')[] = [
    'left',
    'left',
    ...stages.map(() => 'right' as const),
    'left',
    'left'
  ];
  const signed = (value: number | null): string => {
    if (value === null) return '-';
    const magnitude = Math.abs(value).toFixed(3);
    return magnitude === '0.000' ? magnitude : `${value > 0 ? '+' : '-'}${magnitude}`;
  };
  const body = comparison.rows.map((row) => [
    row.model,
    row.engine,
    ...stages.map((stage) =>
      signed(row.stages.find((delta) => delta.stage === stage)?.delta ?? null)
    ),
    row.status === 'compared' ? (row.fingerprintChanged ? 'CHANGED' : 'same') : '-',
    row.status
  ]);
  return [`Baseline ${path}`, table(headers, body, align)].join('\n');
}

interface CompositionOutputMeta {
  generated?: {
    digest: string;
    models: number;
    bytes: number;
    fixtures: { id: string; title: string; root: string; composition: string }[];
  };
  steelThread?: { root: string; composition: string; catalog: string };
}

interface CompositionOptions {
  json?: boolean;
  output?: string;
  baseline?: string;
  'fail-on-geometry-change'?: boolean;
  fixture?: string;
  model?: string;
  catalog?: string;
}

async function finishComposition(
  rows: CompositionRow[],
  values: CompositionOptions,
  meta: CompositionOutputMeta,
  iterations: number,
  commit: string | null,
  timestamp: string
): Promise<void> {
  let comparison: CompositionComparison | undefined;
  let baselinePath: string | undefined;
  if (values.baseline !== undefined) {
    baselinePath = resolve(values.baseline);
    const baseline = parseBenchRows(
      await readFile(baselinePath, 'utf8')
    ) as unknown as CompositionRow[];
    comparison = compareCompositionRows(rows, baseline);
  }
  if (values.output !== undefined) {
    const path = resolve(values.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  if (values.json)
    console.log(
      JSON.stringify(
        {
          version: 1,
          mode: 'composition',
          commit,
          timestamp,
          iterations,
          ...meta,
          rows,
          // The server bounds seam: retained cache bytes, jobs and rejected work after the run.
          stats: getCompositionStats(),
          ...(comparison ? { baseline: { path: baselinePath, ...comparison } } : {}),
          ...(values.output !== undefined ? { output: resolve(values.output) } : {})
        },
        null,
        2
      )
    );
  else {
    console.log(renderCompositionRows(rows));
    console.log(
      `\n${rows.length} composition rows · ${iterations} iterations after one warm-up${commit ? ` · commit ${commit.slice(0, 7)}` : ''}`
    );
    if (comparison) console.log(`\n${renderCompositionComparison(comparison, baselinePath!)}`);
    if (values.output !== undefined) console.log(`\nWrote ${resolve(values.output)}`);
  }
  if (values['fail-on-geometry-change'] && comparison?.geometryChanged) {
    console.error(JSON.stringify({ error: 'Geometry fingerprint changed against the baseline' }));
    process.exitCode = 1;
  }
}

/** Generate the fixture matrix under a temporary catalog and measure every fixture. */
async function runCompositionMatrix(values: CompositionOptions, iterations: number): Promise<void> {
  const requested = list(values.fixture);
  const generated = generateFixtures(requested.length ? requested : undefined);
  const digest = fixtureDigest(generated);
  const directory = await mkdtemp(join(tmpdir(), 'fractal-bench-composition-'));
  try {
    const written = await writeFixtures(generated, directory);
    const commit = gitCommit();
    const timestamp = new Date().toISOString();
    const rows: CompositionRow[] = [];
    for (const fixture of generated.fixtures) {
      const { row } = await measureComposition({
        catalog: written.catalog,
        root: fixture.root,
        composition: fixture.composition,
        label: fixture.id,
        iterations
      });
      rows.push({ ...row, commit, timestamp });
    }
    await finishComposition(
      rows,
      values,
      {
        generated: {
          digest,
          models: generated.models.length,
          bytes: written.bytes,
          fixtures: generated.fixtures.map((fixture) => ({
            id: fixture.id,
            title: fixture.title,
            root: fixture.root,
            composition: fixture.composition
          }))
        }
      },
      iterations,
      commit,
      timestamp
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The local steel thread: one authored composition resolved through the caller's catalog. This
 * never writes or bundles a repository model; it reads only the catalog the caller names.
 */
async function runSteelThread(
  values: CompositionOptions,
  iterations: number,
  composition: string
): Promise<void> {
  if (values.model === undefined) throw new Error('--composition ID requires --model ROOT');
  if (values.catalog === undefined)
    throw new Error(
      '--composition ID requires --catalog PATH; repository models are never bundled'
    );
  const commit = gitCommit();
  const timestamp = new Date().toISOString();
  const { row } = await measureComposition({
    catalog: values.catalog,
    root: values.model,
    composition,
    label: `steel-thread:${values.model}`,
    iterations
  });
  await finishComposition(
    [{ ...row, commit, timestamp }],
    values,
    {
      steelThread: {
        root: values.model,
        composition,
        catalog: resolve(values.catalog)
      }
    },
    iterations,
    commit,
    timestamp
  );
}

export async function runBench(argv: string[]): Promise<void> {
  const extracted = extractComposition(argv);
  const { values } = parseArgs({
    args: extracted.args,
    options: {
      catalog: { type: 'string' },
      model: { type: 'string' },
      directory: { type: 'string' },
      synthetic: { type: 'string' },
      fixture: { type: 'string' },
      views: { type: 'string', default: 'both' },
      engine: { type: 'string' },
      iterations: { type: 'string', default: '5' },
      json: { type: 'boolean' },
      output: { type: 'string' },
      baseline: { type: 'string' },
      'fail-on-geometry-change': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help) {
    console.log(BENCH_HELP);
    return;
  }
  const iterations = Number(values.iterations);
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new Error('Iterations must be a whole number of at least 1');
  // Nothing to fail against: a silent exit 0 here would read as a passing gate.
  if (values['fail-on-geometry-change'] && values.baseline === undefined)
    throw new Error('--fail-on-geometry-change needs a --baseline to compare against');
  if (extracted.composition.real !== undefined) {
    await runSteelThread(values, iterations, extracted.composition.real);
    return;
  }
  if (extracted.composition.matrix) {
    await runCompositionMatrix(values, iterations);
    return;
  }
  if (!['scene', 'all', 'both'].includes(values.views!))
    throw new Error('Views must be scene, all or both');
  const engines: BenchEngineId[] = list(values.engine).length
    ? list(values.engine).map((id) => {
        if (!isBenchEngineId(id))
          throw new Error(`Unknown layout engine: ${id} (known: ${BENCH_ENGINES.join(', ')})`);
        return id;
      })
    : [...BENCH_ENGINES];

  const sources = await resolveSources(values);
  if (!sources.length) throw new Error('No models to measure');
  const commit = gitCommit();
  const timestamp = new Date().toISOString();
  const rows: BenchRow[] = [];
  for (const source of sources) {
    const { model } = await source.load();
    for (const view of viewsFor(model, values.views as 'scene' | 'all' | 'both'))
      for (const engine of engines) {
        const measured = await measureSubject(
          {
            load: source.load,
            state: view.state,
            engine,
            title: view.title,
            subtitle: view.subtitle
          },
          iterations
        );
        rows.push({
          model: source.id,
          view: view.id,
          engine,
          source: source.source,
          nodes: measured.nodes,
          edges: measured.edges,
          width: Math.round(measured.diagram.width * 100) / 100,
          height: Math.round(measured.diagram.height * 100) / 100,
          iterations,
          stages: measured.stages,
          fingerprint: geometryFingerprint(measured.diagram),
          quality: qualityMetrics(measured.diagram),
          commit,
          timestamp
        });
      }
  }

  let comparison: BaselineComparison | undefined;
  if (values.baseline !== undefined) {
    const baseline = parseBenchRows(await readFile(resolve(values.baseline), 'utf8'));
    comparison = compareToBaseline(rows, baseline);
  }
  if (values.output !== undefined) {
    const path = resolve(values.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  if (values.json)
    console.log(
      JSON.stringify(
        {
          version: 1,
          commit,
          timestamp,
          iterations,
          engines,
          views: values.views,
          rows,
          ...(comparison ? { baseline: { path: resolve(values.baseline!), ...comparison } } : {}),
          ...(values.output !== undefined ? { output: resolve(values.output) } : {})
        },
        null,
        2
      )
    );
  else {
    console.log(renderRows(rows));
    console.log(
      `\n${rows.length} rows · ${iterations} iterations after one warm-up · engines ${engines.join(', ')}${commit ? ` · commit ${commit.slice(0, 7)}` : ''}`
    );
    if (comparison) console.log(`\n${renderComparison(comparison, resolve(values.baseline!))}`);
    if (values.output !== undefined) console.log(`\nWrote ${resolve(values.output)}`);
  }
  if (values['fail-on-geometry-change'] && comparison?.geometryChanged) {
    console.error(JSON.stringify({ error: 'Geometry fingerprint changed against the baseline' }));
    process.exitCode = 1;
  }
}
