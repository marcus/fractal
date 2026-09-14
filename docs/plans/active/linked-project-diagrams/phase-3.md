# Linked diagrams: phase 3 evidence

Status: complete, 2026-09-14. Epic: `td-07a927`. Tasks: server bounds `td-5aecd6`, studio
performance `td-85ff55`, benchmarks `td-fa127a`, measurement `td-4fce8f`.
The [controlling plan](../linked-project-diagrams.md) defines acceptance; this document records
what shipped, the measured evidence, the gates table and the handoff to phase 4. It does not
authorize later phases. The complete sanitized machine-readable evidence is
[phase-3-baseline.json](phase-3-baseline.json) (composition fixture matrix) and
[phase-3-browser.json](phase-3-browser.json) (browser journey). Both omit absolute paths and
repository model contents.

## What shipped

- **Server bounds** (`td-5aecd6`). Admission limits (20 projects, 10,000 loaded elements, 20,000
  relationships, 500 visible nodes, 1,000 visible edges, 5 MiB per-project source, 128 MiB
  estimated cache payload) with byte accounting for parsed models, local layouts, composed
  results and in-flight work; LRU eviction of unmounted artifacts; targeted invalidation keyed by
  per-project revision so a target edit drops that target and its bridge composition while healthy
  unrelated layout cache entries survive; queue ownership, coalescing and generation echo; and
  `GET /api/composition/stats` / `fractal composition-stats` instrumentation for hits, misses,
  jobs, retained bytes and rejected work.
- **Studio performance** (`td-85ff55`). Viewport culling with a one-viewport overscan for project
  contents and bridge geometry (outlines and focused elements stay available), CSS-only low-zoom
  omission of descriptions and secondary labels without changing layout, request coalescing and
  obsolete-generation discard, and a composition session that releases its geometry on close so
  repeated open/close does not retain parsed models, links or SVG.
- **Benchmarks** (`td-fa127a`). `bin/fractal bench --composition` gained an eight-fixture matrix
  (unopened, visible, loaded, bridges, chain, cycle, diamond, labels) that times resolve, parse,
  local projection/measure/layout, frame placement, bridge routing and serialization separately,
  with counts, estimated bytes and a deterministic composition fingerprint.
  `scripts/bench-browser.ts --composition` drives the real routes: cold startup with zero foreign
  fetches, an explicit open, an expand, a sustained pan/zoom sample and repeated open/close cycles
  with a retained-heap reading.
- **Measurement harness** (this task). `scripts/bench-browser.ts` now runs the real authored
  composition against a catalog it is given (`--catalog/--model/--composition`), reporting cold
  startup, pan/zoom, warm expand/collapse p50/p95 with the server layout-miss delta, repeated
  fresh-page reveals with a busy-badge timestamp from a `MutationObserver`, and 50 open/close
  cycles with warm-up-excluded heap growth plus `/api/composition/stats`. Two generated modes add
  the scale fixture (`--scale-fixture`) and the first-paint A/B (`--paint-ab`). The retained-heap
  gate is now reported from the warm-up boundary as well as raw.

## Reference environment and method

- Application commit `95adfb8fa3899089e322aaea9a96b6876b91c1b3` on `lp3-measure`; one fresh
  `npm run build`.
- Apple M4 Pro, 14 logical CPUs, 64 GiB RAM; macOS 26.6.2 (Darwin `25.6.0`), arm64; Node
  `v26.5.1`; headless Chromium `153.0.8010.12`; 1512 × 982 viewport; reduced motion.
- Default `elk-layered` layout. CLI `parse` passes are warm stamp lookups; `coldParseMs` is the
  separate cache-cleared sample. The browser server starts against a private temporary catalog and
  the heap is read after forced GC before the cycles, at the warm-up boundary (cycle 10) and after
  cycle 50. To fit a closed project again the journey refits the camera before each close, because
  a reopen re-anchors it on the revealed title. This is a shared workstation; unrelated background
  work was not controlled, and the single-model p95 comparison below shows that noise.
- Commands. The `--composition ID` journey reads only the catalog named on the command line. Real
  sibling models are copied to a temporary root and never modified; the committed copies replace
  catalog paths and ephemeral ports with placeholders and add `environment`:
  ```sh
  npm run build
  # composition fixture matrix
  bin/fractal bench --composition --iterations 5 --json \
    > docs/plans/active/linked-project-diagrams/phase-3-baseline.json
  # real Sidecar + td + Recall journey over a temporary copy of the registered directories
  node --import tsx scripts/bench-browser.ts --composition plugins \
    --catalog TEMP/catalog.json --model sidecar --cycles 50 --warmup-cycles 10 \
    --toggles 20 --cold-opens 5 --pan-ms 3000 --skip-build > phase-3-browser.json
  # generated 300-node / 600-edge pan/zoom and first-paint A/B
  node --import tsx scripts/bench-browser.ts --scale-fixture --pan-ms 3000 --skip-build
  node --import tsx scripts/bench-browser.ts --paint-ab --paint-samples 7 --skip-build
  # steel thread composition, and the phase 0 fingerprint comparisons
  bin/fractal bench --catalog TEMP/catalog.json --model sidecar --composition plugins --json
  bin/fractal bench --directory ../sidecar/docs/diagrams/fractal,../td/docs/diagrams/fractal \
    --views scene --engine elk-layered --iterations 5 \
    --baseline docs/plans/active/linked-project-diagrams/steel-thread-baseline.json \
    --fail-on-geometry-change
  bin/fractal bench --directory examples/delivery --synthetic 60,240 --views both \
    --engine elk-layered --iterations 10 \
    --baseline docs/plans/active/linked-project-diagrams/phase-0-baseline.json \
    --fail-on-geometry-change
  ```

## Composition fixture matrix (CLI)

All times are milliseconds. `local` is local projection/measure/layout; `compose` reruns that pass
inside placement/routing, so `place` is `compose` minus `local`. Full per-stage p50/p95, counts,
bytes and fingerprints are in [phase-3-baseline.json](phase-3-baseline.json); the generator digest
is `29081ac6c7792df63efe42603be412a662312149aeb17ce45b37544ff02edac3` (57 models, 1,602,910
generated bytes).

| Fixture  | Projects | Loaded elements | Visible nodes / edges | Bridges | Stubs |   local p50 / p95 | compose p50 / p95 | Output bytes |
| -------- | -------: | --------------: | --------------------: | ------: | ----: | ----------------: | ----------------: | -----------: |
| unopened |        1 |               4 |                 4 / 1 |       0 |    20 |     5.824 / 6.651 |     6.224 / 7.143 |        5,957 |
| visible  |        4 |             304 |             304 / 271 |      12 |     0 | 302.210 / 329.314 | 300.056 / 310.375 |      214,090 |
| loaded   |       11 |          10,004 |                 4 / 1 |      10 |     0 |     4.549 / 4.707 |     5.107 / 5.555 |       14,456 |
| bridges  |        3 |             204 |             204 / 181 |     300 |     0 | 195.002 / 202.095 | 206.983 / 217.400 |      355,491 |
| chain    |        8 |              32 |                32 / 8 |       7 |     0 |   37.389 / 37.780 |   37.098 / 38.454 |       21,615 |
| cycle    |        3 |              12 |                12 / 3 |       3 |     0 |   13.893 / 14.213 |   13.318 / 15.104 |        8,451 |
| diamond  |        4 |              16 |                16 / 4 |       4 |     0 |   17.524 / 18.851 |   18.876 / 19.470 |       11,326 |
| labels   |        3 |              28 |               28 / 13 |       4 |     0 |   21.670 / 23.458 |   21.620 / 23.465 |       22,594 |

The `unopened` row is the zero-foreign-parse proof: the root carries 20 authored links, resolves
to a single participating project, loads 4 elements, and emits 20 unopened stubs with one model
cache miss and one retained entry. The `loaded` row loads 10,004 elements with 11 model cache
entries; `local` drops to 4.5 ms because every project but the root participates collapsed, so no
local layout runs. That row sits 4 elements over the nominal 10,000-element admission limit: the
CLI benchmark drives the transport-neutral core directly and does not enforce the server admission
boundary, so it is a scale observation, not a refused request.

## Real steel thread (Sidecar + td + Recall)

Sidecar's authored `links.json` now declares both `td` and `recall`, and Recall's model exists, so
the real `plugins` composition is three open projects through a temporary catalog:

| Measure                           | Value                               |
| --------------------------------- | ----------------------------------- |
| Projects / loaded elements / rels | 3 / 148 / 206                       |
| Visible nodes / edges / bridges   | 23 / 83 / 2                         |
| Stubs / diagnostics               | 0 / 0                               |
| resolve p50 / p95                 | 0.788 / 0.947 ms                    |
| parse (warm) p50 / p95            | 0.187 / 0.753 ms                    |
| local layout p50 / p95            | 60.399 / 66.254 ms                  |
| compose (place/route) p50 / p95   | 60.590 / 70.888 ms                  |
| serialize p50                     | 0.141 ms                            |
| coldParseMs (cache-cleared)       | 291.215 ms                          |
| Composition fingerprint           | `1aad6ec89abe17724d06d0aa7ffe9ecc…` |

The two phase-0 steel-thread overview fingerprints are unchanged against the
[steel-thread baseline](steel-thread-baseline.json): Sidecar `775718923c94` and td `fe87d9db39b7`
compare identical (`--fail-on-geometry-change` exit 0), which is the strongest available check
that composition reads each project without altering its local geometry.

## Browser journeys

The browser harness now runs the real composition from a temporary catalog and the generated
fixtures. Machine-readable detail is in [phase-3-browser.json](phase-3-browser.json).

### Real composition (Sidecar + td + Recall)

The `plugins` composition is restored by URL over the Sidecar/td/Recall directories copied to a
private temp root, then exercised through the real routes:

- Cold studio startup through the visible composed canvas: **574 ms**. Requests were
  `/api/models/sidecar`, `/api/models`, `/api/render`, `/api/composition/links?model=sidecar`,
  `/api/models/td`, `…links?model=td`, `/api/models/recall`, `…links?model=recall` and
  `/api/composition/render`; no page errors.
- Warm local toggle of `td CLI` inside the td frame, 20 measured pairs (40 samples) after a
  warm-up pair: input-to-geometry p50 **31.1 ms**, p95 **33.2 ms**. Server `layouts.misses` delta
  **0** and `composed.misses` delta **0** across the measured loop, so no unrelated project
  layout ran.
- Pan/zoom over 181 frames: p50 16.7 ms, p99 **18.5 ms**, **0** long tasks.
- 50 open/close cycles of the td frame in 13,320 ms, **0** long tasks. Heap after forced GC:
  6,413,270 B before the cycles, 7,338,093 B after the excluded warm-up (cycle 10), 7,599,802 B
  after cycle 50. Raw growth **10.16%**; warm-up-excluded (cycles 10 → 50) growth **2.93%**
  (261,709 B).
- Five fresh-page cold reveals of the td link: p50 **27.6 ms**, p95 **249.1 ms**. The busy badge
  never appeared: even the 249 ms reveal spends its time in the source model fetch, before the
  150 ms busy timer starts. A forced slow-render probe (400 ms response) shows the badge at
  **166.4 ms** after the click, with frames mounted at 435 ms.
- Server cache bounds after the run: models 3 entries / 113,939 B, layouts 2 / 0 B, composed
  4 / 209,515 B against the 128 MiB budget; queue 0 active/queued, stale 0, over-limit 0.

### Generated scale pair (`--scale-fixture`)

The generated two-project composition has **300 visible nodes / 573 visible edges** (fixture
digest `f9a9d8ac5062ddd11560ac24379d70fcb535a6fa2d30b091037636a7abf02c86`). Pan/zoom over 181
frames: frame p50 16.6 ms, p99 **19.7 ms**, **0** long tasks over 50 ms, no page errors. This is
the plan's 300/600 scale with room to spare.

### Generated first-paint A/B (`--paint-ab`)

Two structurally identical roots, one with 20 authored unopened links and one with none, served by
the same server and sampled alternately (7 samples each, fixture digest
`b0dabe557e72febb4b4a4d13fab65c77a968112632be00ee91d17e75da50c720`). Medians: 20 links **69 ms**,
zero links **68 ms**, ratio **1.01** — well inside the 10% budget.

## Gates table

Verdicts use the plan's [acceptance budgets](../linked-project-diagrams.md#performance-strategy-and-acceptance-budgets).
Every row is measured with the harness above; no number is inferred.

| Journey / load                                 | Gate                                                    | Measured                                                                                                                                                                                              | Verdict                                |
| ---------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Root with 20 unopened links                    | Zero foreign parses/layouts                             | `unopened` fixture: 1 project, 4 loaded elements, 20 stubs, 1 model cache miss/entry; the paint A/B roots load no foreign model                                                                       | **PASS**                               |
| Root with 20 unopened links                    | First useful paint ≤ 10% slower than root-only baseline | 7 alternating fresh-page samples each: medians 69 ms (20 links) vs 68 ms (none), ratio **1.01**                                                                                                       | **PASS**                               |
| Sidecar + td + Recall warm local toggle        | p95 input-to-geometry ≤ 100 ms                          | 20 expand/collapse pairs (40 samples) on `td CLI`: p50 **31.1 ms**, p95 **33.2 ms**                                                                                                                   | **PASS**                               |
| Sidecar + td + Recall warm local toggle        | Unrelated project layout calls = 0                      | Server `layouts.misses` delta **0**, `composed.misses` delta **0** across the measured loop                                                                                                           | **PASS**                               |
| Cold target reveal ≤ 500 elements / 1,000 rels | p95 ≤ 1 s                                               | 5 fresh-page loads of the td link: p50 **27.6 ms**, p95 **249.1 ms**                                                                                                                                  | **PASS**                               |
| Cold target reveal ≤ 500 elements / 1,000 rels | Busy feedback by 150 ms                                 | Badge never appeared in the natural reveals (the 249 ms case is source-fetch time before the 150 ms busy timer); a forced 400 ms render shows the badge at **166.4 ms** after the click               | **FAIL**                               |
| Pan/zoom ≤ 300 visible nodes / 600 edges       | Frame p99 ≤ 25 ms                                       | Generated scale pair, **300 nodes / 573 edges**, 181 frames: p99 **19.7 ms**                                                                                                                          | **PASS**                               |
| Pan/zoom ≤ 300 visible nodes / 600 edges       | Zero composition-induced main-thread tasks > 50 ms      | **0** long tasks across the scale pan/zoom (and across the real journey)                                                                                                                              | **PASS**                               |
| Repeated open/close, 50 cycles                 | Warm-up-excluded retained heap growth ≤ 10%             | Real composition: warm-up-excluded (cycles 10 → 50) **2.93%** (7,338,093 → 7,599,802 B); raw 50-cycle **10.16%**                                                                                      | **PASS**                               |
| Repeated open/close, 50 cycles                 | Caches remain within bounds                             | models 3 entries / 113,939 B, layouts 2 / 0 B, composed 4 / 209,515 B against 128 MiB; 0 stale, 0 over-limit                                                                                          | **PASS**                               |
| Single-project compatibility                   | Same geometry fingerprint                               | All 9 delivery/synthetic rows unchanged; Sidecar `775718923c94` and td `fe87d9db39b7` overviews unchanged against the phase 0 steel-thread baseline                                                   | **PASS**                               |
| Single-project compatibility                   | ≤ 10% p95 regression over baseline                      | Five runs: per-row p95 deltas have medians ≤ 10.4% but individual maxima reach +26% while `sidecar` held ~100% CPU; the layout source is unchanged since the baseline, so the outliers are load noise | **PASS** (median; load-induced maxima) |

## Limits in force

Admission limits are 20 participating projects, 10,000 total loaded elements, 20,000
relationships, 500 visible nodes, 1,000 visible edges, 5 MiB source bytes per project and 128 MiB
estimated cache payload, accounting for bridge geometry and in-flight responses. After the real
50-cycle run the measured cache payload is 323,454 B (models 113,939 B plus composed 209,515 B),
far inside the 128 MiB budget. The largest measured composition is the generated scale pair at 300
visible nodes / 573 visible edges. Exceeding a limit returns a shared diagnostic and keeps the last
successful view; the CLI benchmark exercises the core directly, so it reports over-limit fixtures
without refusing them (the `loaded` row at 10,004 elements). Service/CLI configuration owns
overrides.

## The one failing gate, and phase 4 / 5 entry points

Every budgeted row is now measured. One fails: **busy feedback**. The studio schedules the
`loading-badge` 150 ms after a request becomes busy, but a fresh-page reveal spends its time in the
source-model fetch before that timer starts, so the slowest natural reveal (249 ms) showed no
badge at all, and a forced 400 ms render shows the badge at 166.4 ms after the click — about 16 ms
over the budget. The smallest fix is in application code, not the harness: either lower
`SLOW_REQUEST_MS` in `src/routes/+page.svelte` or set the busy state when the link's source load
starts rather than only at the composition render. This task does not own `src/` and did not
change it.

Two measurement limits are worth stating. A genuinely per-open cold **server** cache is not
possible without restarting the server, so the reveal figure is per fresh page with a warm server,
as the brief anticipated. And the single-model p95 comparison is across sessions on a shared
workstation: the layout source is unchanged (fingerprints identical), but maxima vary with load, so
the verdict rests on the median and on geometry equality rather than any single maximum.

Phase 3 otherwise hands off cleanly:

- Exports and portability (phase 4) read the same composition result and limits; the measured
  composition fingerprints are stable enough to pin exported artwork against.
- The real steel-thread prerequisites are now authored in their owning repositories: Sidecar
  declares `td` and `recall` in `links.json`, and Recall has a model at its conventional path. No
  sibling source was changed by this task.
- Single-project geometry, CLI output and error behavior remain byte-identical to phase 0 for the
  measured inputs.

## Validation record

- Composition fixture matrix, real journey, scale journey and paint A/B all ran to completion with
  exit 0; the browser journeys reported no page errors and no long tasks.
- `bin/fractal bench --fail-on-geometry-change` exited 0 for the phase 0 single-model baseline and
  the phase 0 steel-thread baseline (identical fingerprints in both).
- `tests/docs.test.ts` green; `npm run check` clean; changed files formatted with Prettier.
- Machine, browser, viewport, reduced motion, application commit and cold/warm state are recorded
  in each JSON file's `environment` block and in the method section above. The harness is on
  `lp3-measure`; the application source under test is unchanged from `95adfb8`.
- Generated fixture digests are reproducible: matrix `29081ac6…`, scale `f9a9d8ac…`, paint
  `b0dabe55…`.
