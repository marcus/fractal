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

## What step 2 changed (2026-09-11, same machine, bundled examples, `node build`)

The benchmark of step 1 does not exist yet, so these are hand-measured on the delivery example
rather than the catalog. The shape of the result is what matters; the table above stays the
reference for the larger catalog models.

| Measurement                            | Before     | After    |
| -------------------------------------- | ---------- | -------- |
| `GET /api/models`                      | 152–198 ms | 1–3 ms   |
| `POST /api/render`, repeated view      | 82–97 ms   | 1–2 ms   |
| `POST /api/render`, first of its kind  | 85 ms      | 15–18 ms |
| Click to new geometry, expand/collapse | 114–147 ms | 14–21 ms |
| Page open to first node drawn          | 830 ms     | 237 ms   |
| "Composing view" badge on fast work    | every time | never    |

Geometry is unchanged: `bin/fractal layout` JSON for delivery, delivery show-all and observatory
is byte-identical before and after, as is the `/api/render` payload over HTTP, cold and warm.

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

Shape as built:

```text
project(model, state) → measure(projection) → engine.layout(measured, request) → assemble → Diagram
      core/projection      core/measure           adapters/layout/*                core/layout
```

- `src/lib/core/measure.ts`: `measure(projection): MeasuredGraph`. Nodes carry the element, depth,
  expanded, width, height, header height, `titleLines`, `descriptionLines`, `kindLabel`, in
  depth-first authored order; edges carry `labelLines` and the label box. Uses the shared
  `ARCHITECTURE_NODE_METRICS` profile. Pure and synchronous.
- `src/lib/core/layout-engine.ts`: the contract. `LayoutEngine` has `id`, `title`,
  `description` and `layout(graph, request): Promise<Placement>`. `LayoutRequest` carries the
  density profile only; direction is a property of an engine, not of a view, so a top-down engine
  is a registry entry rather than a request option. `Placement` maps node ids to absolute boxes
  and edge ids to route points plus an optional label anchor, with the diagram extent.
- `src/lib/core/layout-engines.ts`: the registry of ids and copy (`LAYOUT_ENGINES`,
  `DEFAULT_LAYOUT_ENGINE`, `getLayoutEngineInfo`, `isLayoutEngineId`), mirroring `themes.ts`. It
  imports no engine, so validation and the studio bundle stay free of ELK.
- `src/lib/adapters/layout/index.ts`: implementations by id (`getLayoutEngine`,
  `allLayoutEngines`). `src/lib/adapters/layout/elk.ts` is a factory for ELK layered placement
  with a flow direction; the default engine is `elk-layered`, left to right, with the options
  and geometry the studio always had. The factory also takes the ELK instance to place with, so
  where ELK runs is a deployment choice rather than an engine: `elk-instance.ts` is the bundled
  main-thread build for Node, the CLI, the server and the tests, and `elk-instance.portable.ts`
  is a worker, substituted by the reader build. Same options, same graph, same geometry.
- `src/lib/core/layout.ts`: `layout(model, state, engine?)` runs the pipeline, choosing the engine
  from `state.layout` when none is passed, and `assembleDiagram` re-wraps expanded titles to their
  placed width, enforces visible authored parents, and echoes the view state. The canvas, SVG,
  HTML export, CLI and portable viewer consume the same `Diagram` as before.
- `ViewState.layout?: LayoutEngineId` rides in scenes (validated by the LikeC4 adapter), links,
  the CLI (`--layout ID`, `engines`), the API and exports. Absent means the default.
- `tests/layout-engines.test.ts` runs every registered engine over a nested fixture and both
  bundled examples: determinism, children inside parents below the header, no sibling overlap,
  edge endpoints on the border of their nodes on any side, labels clear of collapsed nodes and of
  each other, nodes within the diagram extent. The ELK-specific left/right endpoint assertions
  stay in `tests/layout.test.ts`.

Candidate engines after the seam exists, each an explicit id and never the default:

- `elk-layered-fast`: thoroughness and crossing-minimization presets for very large views.
- `elk-layered-down`: top-to-bottom direction for portrait screens and tall documents.
- An aspect-targeted variant that biases toward a 16:9 slide or a phone viewport.
- A placement engine that honors authored positions with collision avoidance (product plan
  question 4).

## Benchmark tool

`bin/fractal bench` (also `npm run bench`). Agent-first, non-interactive, deterministic order.

- Inputs: the resolved catalog plus the bundled examples by default, deduped by directory
  (`--catalog`, `--model` and `--directory` narrow it; naming directories measures exactly those);
  `--views scene|all|both` (default both: each authored scene plus show-all of the first scene);
  `--engine ID[,ID]` (default: all registered, and an unknown id is rejected); `--iterations N`
  (default 5 measured runs after one discarded warm-up); `--synthetic N[,N]` generates a
  deterministic model with N elements in a three-level hierarchy and proportional relationships,
  so scaling is visible before a real model reaches it — on its own it replaces the model set,
  alongside a narrowing flag it adds to it.
- Stages timed per run: load (read and parse), project, layout, SVG export, and sequence layout
  for models with journeys. Reported as p50 and p95 with node and edge counts and diagram width
  and height. Layout is one engine call today; it splits into measure, engine and assemble when
  the seam lands, and the `measure` stage stays absent rather than reported as zero until then.
- Geometry fingerprint: a hash of every node and edge coordinate rounded to 0.01, per model, view,
  and engine. Identical fingerprints prove an optimization changed nothing visible.
- Quality metrics for engine comparison: edge crossings, bend count, total edge length, area,
  aspect ratio. Cheap to compute from a `Diagram` and engine-neutral.
- Output: a readable table by default; `--json` for one document; `--output artifacts/bench/<stamp>.jsonl`
  writes one row per model, view, engine; `--baseline FILE` compares against an earlier run and
  prints time deltas and any fingerprint change, exiting nonzero on `--fail-on-geometry-change`.
  `artifacts/` is already ignored by git. Milestone numbers are copied into this plan by hand.
- `npm run bench:browser` (`scripts/bench-browser.ts`): Playwright against a studio at `--url`, or
  against a build it makes and serves on a free port itself, and against a freshly exported
  portable document. Records the page-open request waterfall, click-to-geometry latency for one
  expand, one collapse, and show-all, frame p50/p99, and long tasks during each; the portable
  document has no show-all, so it reports the two toggles. Toggle latency is the headline number.
  Prints JSON; it is a proof tool, not part of CI.

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
4. **Worker ELK for the portable document.** Landed (td-1ff679). The ELK engine takes its ELK
   instance rather than importing one, so the same engine code runs on the bundled main-thread
   build in Node and on a worker inside the reader. `adapters/layout/elk-instance.ts` provides the
   first; `elk-instance.portable.ts` starts elkjs's worker script, inlined by the reader build and
   run from a blob URL, so the document still makes no request from `file://` or a nested HTTP
   path. The reader ships one copy of ELK, not two: a browser without workers reports that through
   the viewer's error path rather than falling back to a second embedded ELK. Long tasks during
   toggles drop to zero; geometry identical.
5. **Engine presets, each a decision.** Only after 1–4: add `elk-layered-fast` and
   `elk-layered-down` behind explicit ids, compare with the benchmark's quality metrics, and show
   real catalog models in the studio before either is recommended anywhere.

Each step is a td ticket under `td-0b4264`, reviewed by an independent sub-agent for the seam and
any engine change, and finished with `npm run check`, `npm test`, `npm run build`, browser proof,
and a service reinstall.

## Baseline

Recorded on 2026-09-11 (Apple Silicon) with
`bin/fractal bench --output artifacts/bench/baseline-2026-09-11.jsonl`: the resolved catalog plus
the bundled examples, every authored scene plus show-all of the first scene, five measured
iterations after a discarded warm-up. Load is the full read-and-parse of the model, repeated every
iteration because that is what the studio repeats on every request today; layout is the ELK call,
which still projects, measures, places and assembles inside itself. `artifacts/` is not committed,
so the JSONL is the local machine-readable baseline that
`bin/fractal bench --baseline <file> --fail-on-geometry-change` compares against.

The table below shows the bundled examples, Fractal's own model, and td; the full 91-row run over
every catalog project stays in that gitignored JSONL, which is what a comparison reads anyway.

| Model       | View             | Nodes | Edges | Load p50 | Layout p50 | Fingerprint    |
| ----------- | ---------------- | ----- | ----- | -------- | ---------- | -------------- |
| fractal     | overview         | 6     | 11    | 76.1     | 8.5        | `bf0db06ff479` |
| fractal     | pipeline         | 10    | 13    | 76.4     | 12.7       | `2e1736eaa037` |
| fractal     | boundaries       | 6     | 11    | 84.9     | 9.6        | `bf0db06ff479` |
| fractal     | show-all         | 13    | 13    | 81.7     | 13.9       | `5e17b8a798f2` |
| td          | overview         | 9     | 50    | 98.7     | 42.1       | `fe87d9db39b7` |
| td          | cli-surface      | 12    | 7     | 91.2     | 6.4        | `04afa5a9f504` |
| td          | core-and-store   | 28    | 70    | 97.1     | 61.7       | `fd06184de4d7` |
| td          | monitor          | 8     | 6     | 93.2     | 5.6        | `bb2eaa845264` |
| td          | serve-api        | 5     | 3     | 93.5     | 4.8        | `1704eace8550` |
| td          | sync-client      | 7     | 6     | 94.3     | 5.4        | `5d8e7841d28f` |
| td          | sync-server      | 14    | 24    | 97.5     | 15.0       | `f52384d9c1cf` |
| td          | full-detail      | 74    | 123   | 103.1    | 126.0      | `c85ef028959a` |
| td          | trust-boundaries | 34    | 77    | 96.9     | 73.1       | `cf5b4a7a0d28` |
| td          | proposed         | 55    | 115   | 98.6     | 105.8      | `4da565d61550` |
| td          | show-all         | 74    | 123   | 100.0    | 120.6      | `c85ef028959a` |
| delivery    | overview         | 5     | 8     | 79.2     | 5.2        | `31927e3a3897` |
| delivery    | execution        | 8     | 6     | 79.4     | 6.5        | `2bdb1694796b` |
| delivery    | trust            | 8     | 6     | 74.9     | 6.2        | `2bdb1694796b` |
| delivery    | proposal         | 11    | 10    | 81.8     | 7.6        | `e0eb199268b8` |
| delivery    | show-all         | 20    | 14    | 79.9     | 10.9       | `4b76e8443940` |
| observatory | overview         | 5     | 7     | 73.9     | 5.5        | `cee583ae5e65` |
| observatory | execution        | 5     | 2     | 75.7     | 5.1        | `bc003a4a7c0d` |
| observatory | trust            | 5     | 2     | 76.7     | 5.3        | `bc003a4a7c0d` |
| observatory | proposal         | 10    | 11    | 74.4     | 8.2        | `c92f643ab0b7` |
| observatory | show-all         | 13    | 10    | 73.0     | 7.9        | `1710aec1d3c9` |

The headline number comes from `npm run bench:browser`, against a build it starts itself. On td,
click to new geometry is 260 ms to expand, 180 ms to collapse and 265 ms for show-all; page open is
1.85 s, of which `/api/models` alone is 915 ms. Frames hold 16.6 ms at p50 through every toggle and
no long task appears in the studio — the wait is server time, not the browser. The portable
document is the exception, and that run under-reported it: measured again for step 4 on the same
machine and model, the reader blocked its main thread for 106 ms on page open, 128 ms on expand and
51 ms on collapse. The same run on the bundled delivery example: 129 ms expand, 132 ms collapse, 131 ms
show-all, 855 ms page open; the portable document toggles the same view in 97 ms and 48 ms with no
server at all.

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
- 2026-09-11: Step 3 landed (td-c5936b): measurement, engine contract, registry, pipeline,
  ELK adapter factory, `ViewState.layout`, `--layout`, `engines`, contract tests; fingerprints
  and export bytes identical to the pre-seam baseline.
- 2026-09-11: Step 1 landed (td-45b8a9): `bin/fractal bench`, `npm run bench:browser`, and the
  baseline table. Step 2 landed (td-5ca34f): parsed-model cache, layout-result cache, warm-up on
  server start, a delayed "Composing view" badge, and a parallel model request on page open.
- 2026-09-11: Step 4 landed (td-1ff679): the ELK engine takes its ELK instance, and the portable
  document runs elkjs's worker from an inlined blob URL instead of the bundled main-thread build.
  On td, long tasks in the reader went from 106 ms on page open, 128 ms on expand and 51 ms on
  collapse to none at all; click to new geometry went from 158.7 to 146.9 ms expanding and from
  99.9 to 81.2 ms collapsing. `npm run bench:browser -- --model td` agrees: 147.4 ms and 81.2 ms,
  no long task in either toggle or on open, frames at 16.7 ms p50. The document shrank from
  2,121,424 to 2,116,535 bytes, because it now ships one copy of ELK rather than elkjs's bundle.
  Node fingerprints are unchanged and the reader's node transforms match `fractal layout --json`.
