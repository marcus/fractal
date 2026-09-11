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
4. **Worker ELK for the portable document.** Inline the worker script in the single-file export,
   select it in the portable viewer, keep the main-thread engine as fallback when workers are
   unavailable. Long tasks during toggles drop to zero; geometry identical.
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

| Model        | View                   | Nodes | Edges | Load p50 | Layout p50 | Fingerprint    |
| ------------ | ---------------------- | ----- | ----- | -------- | ---------- | -------------- |
| backstage    | overview               | 5     | 12    | 91.3     | 8.9        | `fb8fd14dabf7` |
| backstage    | execution              | 12    | 18    | 94.1     | 19.7       | `6dfe2178c0d2` |
| backstage    | activity-detail        | 5     | 4     | 80.8     | 5.9        | `e00c87596f47` |
| backstage    | dispatch-detail        | 7     | 3     | 83.7     | 7.2        | `821b9208646d` |
| backstage    | capture-detail         | 5     | 3     | 88.9     | 5.7        | `a68c9b433159` |
| backstage    | trust                  | 12    | 18    | 85.2     | 15.3       | `6dfe2178c0d2` |
| backstage    | proposal               | 11    | 14    | 84.5     | 11.3       | `74616e9f4282` |
| backstage    | show-all               | 49    | 44    | 88.8     | 52.7       | `425dff5e3064` |
| fractal      | overview               | 6     | 11    | 76.1     | 8.5        | `bf0db06ff479` |
| fractal      | pipeline               | 10    | 13    | 76.4     | 12.7       | `2e1736eaa037` |
| fractal      | boundaries             | 6     | 11    | 84.9     | 9.6        | `bf0db06ff479` |
| fractal      | show-all               | 13    | 13    | 81.7     | 13.9       | `5e17b8a798f2` |
| sidecar      | overview               | 11    | 25    | 84.5     | 16.5       | `775718923c94` |
| sidecar      | panes-and-terminals    | 5     | 5     | 83.2     | 5.6        | `3fbdbb4a3749` |
| sidecar      | agent-coordination     | 6     | 3     | 84.9     | 5.6        | `e276ea5033d7` |
| sidecar      | shell-durability       | 5     | 3     | 81.2     | 5.1        | `eb0061cd3016` |
| sidecar      | notifications-pipeline | 3     | 1     | 80.1     | 4.5        | `e3aa8c3c5c22` |
| sidecar      | trust-boundaries       | 35    | 41    | 85.5     | 33.9       | `a21ba7e7e078` |
| sidecar      | proposed-roadmap       | 18    | 29    | 83.7     | 20.2       | `01affb965a7b` |
| sidecar      | show-all               | 47    | 46    | 86.0     | 37.5       | `972a220dd8ee` |
| kindle-frame | overview               | 5     | 7     | 79.5     | 6.4        | `bff99a29996b` |
| kindle-frame | content-delivery       | 8     | 12    | 77.6     | 9.0        | `c38629e65cf2` |
| kindle-frame | device-playback        | 7     | 9     | 76.2     | 7.8        | `4b90b3627910` |
| kindle-frame | prompt-strategy        | 8     | 9     | 78.1     | 6.8        | `0fe700b256af` |
| kindle-frame | show-all               | 25    | 37    | 80.0     | 24.6       | `28133a67c9ba` |
| ongoing      | overview               | 9     | 43    | 85.2     | 18.7       | `a30042b67a0e` |
| ongoing      | one-api-two-clients    | 26    | 51    | 88.8     | 31.0       | `779de353e630` |
| ongoing      | scan-pipeline          | 16    | 20    | 88.6     | 9.1        | `b2443619d8f6` |
| ongoing      | catalog-and-rules      | 18    | 50    | 90.6     | 28.4       | `d91659740fc0` |
| ongoing      | outside-the-process    | 31    | 63    | 92.6     | 45.5       | `1bf46e8cc4f9` |
| ongoing      | operations             | 27    | 49    | 90.1     | 33.6       | `3c26a3f0ed10` |
| ongoing      | trust-boundaries       | 61    | 79    | 87.2     | 69.0       | `c5de83a1ceea` |
| ongoing      | proposed-tech-radar    | 37    | 74    | 90.9     | 52.9       | `a8e0dcba2aba` |
| ongoing      | show-all               | 61    | 79    | 83.8     | 63.9       | `c5de83a1ceea` |
| comms        | overview               | 11    | 27    | 84.5     | 15.1       | `18a365cffc52` |
| comms        | command-path           | 19    | 33    | 81.9     | 22.2       | `41fdd8b31f07` |
| comms        | serving-a-request      | 19    | 34    | 80.7     | 21.4       | `9e409e6845a9` |
| comms        | zero-setup-daemon      | 20    | 32    | 83.8     | 21.7       | `e7bd9a1ec660` |
| comms        | daemon-lifecycle       | 18    | 30    | 81.2     | 21.5       | `79c4bdf00102` |
| comms        | inside-the-core        | 6     | 6     | 80.9     | 6.1        | `fc289fd9c610` |
| comms        | store-seam             | 8     | 11    | 80.3     | 7.6        | `c1a83472898f` |
| comms        | one-registry           | 17    | 30    | 81.9     | 24.6       | `b9e91d9ab509` |
| comms        | trust-boundaries       | 40    | 53    | 81.5     | 34.5       | `77f036a3ef60` |
| comms        | phase-9-consumers      | 19    | 31    | 90.8     | 28.7       | `237a17cbb2c2` |
| comms        | show-all               | 43    | 53    | 87.2     | 38.2       | `b396224c547c` |
| comms-web    | overview               | 6     | 14    | 79.2     | 8.1        | `812420f3a939` |
| comms-web    | live-inbox             | 23    | 29    | 76.9     | 20.1       | `15d38e8f3e59` |
| comms-web    | receipts               | 16    | 20    | 78.8     | 13.5       | `103133e35916` |
| comms-web    | portraits              | 11    | 9     | 76.1     | 6.4        | `a2e74486e86c` |
| comms-web    | trust-boundaries       | 26    | 29    | 77.0     | 21.1       | `f5d088c7ea51` |
| comms-web    | show-all               | 26    | 29    | 77.5     | 20.9       | `f5d088c7ea51` |
| naturally    | overview               | 9     | 18    | 80.9     | 10.5       | `360c492ae71d` |
| naturally    | shell                  | 6     | 5     | 83.0     | 5.6        | `f1e6ffc29f7e` |
| naturally    | engine                 | 8     | 8     | 81.1     | 6.4        | `863a3a8bcd94` |
| naturally    | analyzers              | 8     | 2     | 82.5     | 5.3        | `53962d35ea64` |
| naturally    | configuration          | 6     | 6     | 83.3     | 5.6        | `b053dd026f16` |
| naturally    | packs                  | 4     | 1     | 80.3     | 4.6        | `5a0c870b80d3` |
| naturally    | input                  | 6     | 4     | 81.6     | 5.2        | `e3e57f44d73e` |
| naturally    | boundaries             | 34    | 44    | 80.7     | 31.0       | `e228d1901cf2` |
| naturally    | proposed-surfaces      | 11    | 27    | 79.9     | 14.9       | `75040e203600` |
| naturally    | show-all               | 44    | 47    | 80.5     | 32.5       | `774fdc486c0c` |
| td           | overview               | 9     | 50    | 98.7     | 42.1       | `fe87d9db39b7` |
| td           | cli-surface            | 12    | 7     | 91.2     | 6.4        | `04afa5a9f504` |
| td           | core-and-store         | 28    | 70    | 97.1     | 61.7       | `fd06184de4d7` |
| td           | monitor                | 8     | 6     | 93.2     | 5.6        | `bb2eaa845264` |
| td           | serve-api              | 5     | 3     | 93.5     | 4.8        | `1704eace8550` |
| td           | sync-client            | 7     | 6     | 94.3     | 5.4        | `5d8e7841d28f` |
| td           | sync-server            | 14    | 24    | 97.5     | 15.0       | `f52384d9c1cf` |
| td           | full-detail            | 74    | 123   | 103.1    | 126.0      | `c85ef028959a` |
| td           | trust-boundaries       | 34    | 77    | 96.9     | 73.1       | `cf5b4a7a0d28` |
| td           | proposed               | 55    | 115   | 98.6     | 105.8      | `4da565d61550` |
| td           | show-all               | 74    | 123   | 100.0    | 120.6      | `c85ef028959a` |
| avatars      | overview               | 9     | 28    | 93.1     | 14.8       | `7b0e588ab6e6` |
| avatars      | agent-path             | 22    | 41    | 94.2     | 27.5       | `ae296db2d126` |
| avatars      | generation             | 14    | 11    | 91.4     | 8.5        | `c13b133ed7d1` |
| avatars      | service                | 21    | 36    | 85.8     | 23.4       | `996645c0357e` |
| avatars      | web-client             | 12    | 15    | 82.4     | 9.1        | `350bd7597063` |
| avatars      | web-client-api         | 24    | 45    | 87.5     | 24.4       | `8c43f78f5453` |
| avatars      | trust                  | 26    | 43    | 84.6     | 30.9       | `efebee22a821` |
| avatars      | requested-styles       | 16    | 38    | 85.7     | 18.8       | `08ec60eb4655` |
| avatars      | show-all               | 49    | 62    | 86.9     | 43.5       | `573453c1b213` |
| delivery     | overview               | 5     | 8     | 79.2     | 5.2        | `31927e3a3897` |
| delivery     | execution              | 8     | 6     | 79.4     | 6.5        | `2bdb1694796b` |
| delivery     | trust                  | 8     | 6     | 74.9     | 6.2        | `2bdb1694796b` |
| delivery     | proposal               | 11    | 10    | 81.8     | 7.6        | `e0eb199268b8` |
| delivery     | show-all               | 20    | 14    | 79.9     | 10.9       | `4b76e8443940` |
| observatory  | overview               | 5     | 7     | 73.9     | 5.5        | `cee583ae5e65` |
| observatory  | execution              | 5     | 2     | 75.7     | 5.1        | `bc003a4a7c0d` |
| observatory  | trust                  | 5     | 2     | 76.7     | 5.3        | `bc003a4a7c0d` |
| observatory  | proposal               | 10    | 11    | 74.4     | 8.2        | `c92f643ab0b7` |
| observatory  | show-all               | 13    | 10    | 73.0     | 7.9        | `1710aec1d3c9` |

The headline number comes from `npm run bench:browser`, against a build it starts itself. On td,
click to new geometry is 260 ms to expand, 180 ms to collapse and 265 ms for show-all; page open is
1.85 s, of which `/api/models` alone is 915 ms. Frames hold 16.6 ms at p50 through every toggle and
no long task appears, in the studio or in the portable document — the wait is server time, not the
browser. The same run on the bundled delivery example: 129 ms expand, 132 ms collapse, 131 ms
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
- 2026-09-11: Step 1 landed — `bin/fractal bench`, `npm run bench:browser`, and the baseline table.
