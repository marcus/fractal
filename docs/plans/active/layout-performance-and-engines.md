# Layout performance and pluggable layout engines

Controlling plan for architecture-diagram layout performance, the layout-engine seam, and the
layout benchmark. The [product plan](fractal.md) governs scope; this plan governs how geometry is
computed, measured, and swapped. Tracked in td as `td-0b4264`.

## Intent

The felt problem is the "Composing view" wait after expanding or collapsing a component: every
toggle posts to the server, which re-compiles the model from disk and lays the view out again.
Initial load is acceptable. The headline goal is that a toggle never shows perceptible lag.

Keep the studio exactly as it behaves today while making it faster to respond, and open one seam
so a different layout engine (a faster ELK preset, a top-down or portrait arrangement, an
aspect-targeted slide layout, a manual-placement engine) is "write an adapter", never "refactor
the app". Every optimization is proven with a benchmark that also proves the geometry did not
change. Anything that does change geometry is an explicit engine choice, never a silent default.

## What was measured (2026-09-11, Apple Silicon, catalog of 9 projects)

Per render request on the installed studio, `POST /api/render` for the largest catalog model (td,
77 elements, 120 relationships):

| Stage                                        | Scene view | Show all |
| -------------------------------------------- | ---------- | -------- |
| Load and parse model (LikeC4, every request) | 75–160 ms  | same     |
| Projection                                   | < 0.2 ms   | < 0.2 ms |
| ELK layout (warm)                            | 6–25 ms    | 20–90 ms |
| SVG export                                   | < 1 ms     | < 1 ms   |

On a toggle, the wait is the first and third rows of that table plus network: for a typical scene
roughly 100–250 ms, of which two thirds or more is the model re-parse, not layout. Show all on td
takes ~410 ms from click to new geometry, almost all of it server time.

Page open is three serial requests: the project list (`/api/models`, ~940 ms, because it parses
all nine catalog models to read their titles), the model (~120 ms), then the first render
(~170 ms). Page open is not the felt problem; it improves as a side effect of the same cache.

The browser is not the bottleneck at current model sizes. With 74 nodes, 113 edges and ~1,450 SVG
DOM nodes, the studio animates expand, collapse, zoom, and drag at a steady 60 fps with no long
tasks.

The portable HTML document runs ELK on the browser's main thread. A small toggle (9 to 20 nodes)
blocks the main thread for 86–94 ms; larger views block longer. ELK is 1.5 MB of the reader's
1.58 MB of script.

ELK tuning is a design decision, not a free win. Lowering `elk.layered.thoroughness` from 7 to 1
roughly halves layout time but changes geometry (td show-all grew from 5,133 to 5,541 units
tall); `SIMPLE` node placement halves the height and changes the composition; polyline routing
changes edge shapes. None of these may replace the default; each is a candidate engine preset that
the benchmark can compare on time and quality.

Layout uses a module-level ELK instance already; creating an instance costs ~3 ms, so instance
reuse is not a lever.

## Settled decisions

- **No visible change without an explicit choice.** The default engine's geometry is fingerprinted
  by the benchmark; a pure optimization must keep the fingerprint identical per model and view.
- **Cache parsed models, keep validation.** The project list continues to compile every model
  (an invalid model still fails loudly); it stops repeating the work on every request. Invalidate
  on file size and modification time, confirm with the existing content-hash revision.
- **The seam sits between measurement and placement.** Measuring node content (widths, wrapped
  titles, description lines, label boxes) is engine-neutral core logic. Engines receive a measured
  graph and return placement. Assembly back into a `Diagram` and the containment/parent checks stay
  in core, so every engine gets the same guarantees.
- **Engine choice rides in view state, like theme.** An optional `layout` field on `ViewState`
  reaches scenes, links, CLI (`--layout`), API, and exports. Absent means the default ELK layered
  engine, so every existing link, scene, and test keeps its meaning.
- **Benchmark is a CLI command**, `bin/fractal bench`, with JSON and JSONL output, so agents can run
  it, compare runs, and gate changes. A browser benchmark is a separate Playwright script.
- **Sequence layout is out of scope** for the seam. It is already a synchronous, pure core function
  with no external engine; the benchmark times it for completeness only.

## Layout-engine seam

Current shape: `src/lib/adapters/elk-layout.ts` projects, measures, builds the ELK graph, runs ELK,
and reads results back into a `Diagram`. Target shape:

```text
project(model, state) → measure(projection) → engine.layout(measured, options) → assemble → Diagram
      core/projection      core/measure           adapters/layout/*             core/layout
```

- `src/lib/core/measure.ts`: `measure(projection): MeasuredGraph`. Nodes carry id, parent, depth,
  expanded, width, height, header height (for container padding), `titleLines`, `descriptionLines`,
  `kindLabel`; edges carry source, target, `labelLines`, and label box size. Uses the shared
  `ARCHITECTURE_NODE_METRICS` profile. Pure and synchronous.
- `src/lib/core/layout-engine.ts`: the contract.

  ```ts
  interface LayoutEngine {
    readonly id: LayoutEngineId; // 'elk-layered' is the default
    readonly title: string;
    readonly description: string;
    layout(graph: MeasuredGraph, options: LayoutRequest): Promise<Placement>;
  }
  interface Placement {
    nodes: Record<string, { x: number; y: number; width: number; height: number }>;
    edges: Record<string, { points: Point[]; label?: Point }>;
    width: number;
    height: number;
  }
  ```

  `LayoutRequest` starts small: the density profile and the view's direction. Add options only
  when a second engine needs them.

- `src/lib/core/layout.ts`: `layout(model, state, engines?)` orchestrates the pipeline, selects the
  engine from `state.layout`, re-wraps titles of expanded nodes whose width grew, applies the
  parent-integrity check, and returns the `Diagram` the canvas, SVG, HTML, and CLI already consume.
  Callers (`api/render`, `api/export`, `adapters/html.ts`, `scripts/fractal.ts`, the portable
  viewer) import from here instead of the ELK adapter.
- `src/lib/adapters/layout/elk.ts`: the ELK engine, today's options unchanged, module-level
  instance kept. `src/lib/adapters/layout/elk-worker.ts` is the same engine run through
  `elk-worker.min.js` in a browser worker; the portable viewer picks it. Same id, same geometry.
- `src/lib/core/layout-engines.ts`: the registry (`LAYOUT_ENGINES`, `getLayoutEngine`,
  `isLayoutEngineId`), mirroring `themes.ts`. The CLI gains `engines` (list) and `--layout ID`.
- **Contract tests** in `tests/layout-engines.test.ts` run every registered engine over the fixture
  model and the bundled examples: determinism, children inside parents below the header, no sibling
  overlap, edges start and end on the border of their endpoint nodes (not specifically the right
  and left edges, which is ELK-layered-specific), labels clear of collapsed nodes and each other.
  The existing right/left endpoint assertions in `tests/layout.test.ts` stay for the default engine.
- The canvas and SVG do not change. Edge morphing, camera following, and export consume `Diagram`.

Candidate engines after the seam exists, each an explicit id and never the default:

- `elk-layered-fast`: thoroughness and crossing-minimization presets for very large views.
- `elk-layered-down`: top-to-bottom direction for portrait screens and tall documents.
- An aspect-targeted variant that biases toward a 16:9 slide or a phone viewport.
- A placement engine that honors authored positions with collision avoidance (product plan
  question 4).

## Benchmark tool

`bin/fractal bench` (also `npm run bench`). Agent-first, non-interactive, deterministic order.

- Inputs: the resolved catalog by default (`--catalog`, `--model`, `--directory` narrow it, and
  the bundled examples are always included); `--views scene|all|both` (default both: each authored
  scene plus show-all of the first scene); `--engine ID[,ID]` (default: all registered);
  `--iterations N` (default 5 warm runs after one discarded warm-up); `--synthetic N[,N]` generates
  a deterministic model with N elements in a three-level hierarchy and proportional relationships,
  so scaling is visible before a real model reaches it.
- Stages timed per run: load (parse), project, measure, engine, assemble, SVG export, and sequence
  layout for models with journeys. Reported as p50 and p95 with node and edge counts and diagram
  width and height.
- Geometry fingerprint: a hash of every node and edge coordinate rounded to 0.01, per model, view,
  and engine. Identical fingerprints prove an optimization changed nothing visible.
- Quality metrics for engine comparison: edge crossings, bend count, total edge length, area,
  aspect ratio. Cheap to compute from a `Diagram` and engine-neutral.
- Output: a readable table by default; `--json` for one document; `--output artifacts/bench/<stamp>.jsonl`
  writes one row per model, view, engine; `--baseline FILE` compares against an earlier run and
  prints time deltas and any fingerprint change, exiting nonzero on `--fail-on-geometry-change`.
  `artifacts/` is already ignored by git. Milestone numbers are copied into this plan by hand.
- `npm run bench:browser` (`scripts/bench-browser.ts`): Playwright against a `vite preview` or the
  installed service and against a freshly exported portable document. Records the page-open
  request waterfall, click-to-geometry latency for one expand, one collapse, and show-all, frame
  p50/p99, and long tasks. Toggle latency is the headline number. Prints JSON; it is a proof tool, not part of CI.

Both tools regenerate the CLI reference through `npm run docs`, and `tests/docs.test.ts` keeps it
current.

## Work sequence

1. **Benchmark first.** Add `bench` with stages, fingerprint, quality metrics, JSONL, and baseline
   comparison; add the synthetic generator; add the browser bench script. Record the baseline
   table below. Nothing else lands unmeasured.
2. **Caches, no output change.** Parsed-model cache in `src/lib/server/models.ts` keyed by directory,
   invalidated by size and mtime of `model.c4`, `fractal.json`, and `sequences.json`, verified by
   the existing revision hash. A small LRU of layout results keyed by revision and canonical view
   state, so collapsing what was just expanded or revisiting a scene returns immediately. Warm the
   cache when the service starts. Delay the "Composing view" badge by about 150 ms so a fast
   request never flashes it; the badge still appears for genuinely slow requests. Lower priority
   in the same step: fire the project-list and model requests in parallel on page open. Expected:
   a toggle on the largest catalog model from 150–250 ms of wait to under 60 ms; page open from
   ~1.2 s to a few hundred ms. Fingerprints identical.
3. **The seam.** Extract `measure.ts`, `layout-engine.ts`, `layout.ts`, `layout-engines.ts`,
   move ELK to `adapters/layout/elk.ts`, add `state.layout`, `--layout`, `engines`, and the
   parametrized contract tests. Fingerprints identical for the default engine. Update the
   architecture guide, the CLI reference, the model-format guide (scene `layout`), and the Fractal
   skill.
4. **Worker ELK for the portable document.** Inline the worker script in the single-file export,
   select it in the portable viewer, keep the main-thread engine as fallback when workers are
   unavailable. Long tasks during toggles drop to zero; geometry identical.
5. **Engine presets, each a decision.** Only after 1–4: add `elk-layered-fast` and
   `elk-layered-down` behind explicit ids, compare with the benchmark's quality metrics, and show
   real catalog models in the studio before either is recommended anywhere.

Each step is a td ticket under `td-0b4264`, reviewed by an independent sub-agent for the seam and
any engine change, and finished with `npm run check`, `npm test`, `npm run build`, browser proof,
and a service reinstall.

## Baseline (to be filled by step 1)

| Model | View | Nodes | Edges | Load p50 | Engine p50 | Fingerprint |
| ----- | ---- | ----- | ----- | -------- | ---------- | ----------- |
|       |      |       |       |          |            |             |

## Open questions

- Should the project list skip compiling models entirely and read titles from `fractal.json`?
  Faster on a cold start, but an invalid model would no longer fail the listing. The plan keeps
  validation and relies on the cache; revisit if cold start still matters.
- Should `layout` in a scene be allowed to name a non-default engine before step 5 ships an
  alternative? The field exists from step 3 with one valid value; scenes naming an unknown engine
  fail validation like an unknown theme.
- Is the server-side ELK run worth moving off the request thread? Single-reader local service
  today; not until concurrent readers or models several times larger appear.

## Acceptance evidence

- `bin/fractal bench --json` runs over the catalog and examples and reports every stage.
- After step 2: benchmark shows load p50 under 5 ms on warm requests and identical fingerprints;
  browser bench shows expand and collapse under 60 ms click-to-geometry on td, show-all under
  150 ms, and page open under 400 ms; the "Composing view" badge does not appear on a warm toggle.
- After step 3: `bin/fractal engines --json` lists `elk-layered`; `--layout elk-layered` and no
  flag produce identical fingerprints; contract tests pass for every registered engine.
- After step 4: browser bench on the portable document reports no long tasks during toggles.

## Changelog

- 2026-09-11: Created from measurements on the installed studio and catalog; toggle latency made
  the headline goal.
