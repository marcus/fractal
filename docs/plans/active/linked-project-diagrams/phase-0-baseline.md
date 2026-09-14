# Linked diagrams: phase 0 baseline and integration evidence

Measured 2026-09-13 (2026-09-14 UTC), before composition implementation. These numbers establish
the existing single-model path; they do not claim that linked projects meet the release gates.
The complete sanitized [benchmark document](phase-0-baseline.json) includes stage p50/p95,
geometry fingerprints, quality metrics, model counts, source hashes, five browser observations,
request waterfalls, mounted SVG counts and frame timing. It is directly accepted by
`bin/fractal bench --baseline`.

## Reference environment and method

- Baseline application commit: `d59cd3bb1db6c62484d6c6be20b96f9c399c547b`.
- Apple M4 Pro, 14 logical CPUs, 64 GiB RAM; macOS/Darwin `25.6.0`, arm64.
- Node `v26.5.1`; headless Chromium `153.0.8010.12`; 1512 × 982 viewport; reduced motion.
- Fresh `npm run build`; default `elk-layered` layout. The browser benchmark received only
  additive environment/DOM metadata before capture; production behavior was unchanged.
- Public input: bundled fictional `delivery` (23 elements, 16 relationships) and deterministic
  synthetic models with 60/60 and 240/240 elements/relationships. Synthetic generation uses no
  random seed; its source SHA-256 is recorded so the generator itself is pinned.
- CLI: ten measured runs after one discarded warm-up for every view. Layout calls are uncached;
  the real-model `load` stage is a **warm parsed-model-cache lookup**, including file stamps.
  Synthetic `load` constructs a model in memory. Neither is a cold LikeC4 parse measurement.
- Browser: five separate server/browser/portable-reader lifecycles, with one expand, collapse
  and show-all each. Each server uses only bundled examples through an environment override,
  listens on its own random loopback port, and is stopped by the benchmark. No live catalog,
  installed studio, sibling source or tmux session was changed.
- Heavy test/build work was coordinated outside timing. This is a shared workstation, so
  unrelated background activity and OS file caching were not controlled.

Nearest-rank p95 over ten samples is the maximum. Browser sample counts are smaller, so the
summary reports medians and maxima, without treating five observations as robust p95 evidence.

## CLI baseline

All times are milliseconds. Visible counts include the projected container nodes. Full geometry
hashes and individual pipeline stages are in the JSON; the table abbreviates hashes for reading.

| Model / view             | Visible nodes / edges | Layout p50 | Layout p95 | Geometry fingerprint prefix |
| ------------------------ | --------------------: | ---------: | ---------: | --------------------------- |
| delivery / overview      |                 5 / 8 |      6.168 |      8.964 | `31927e3a3897`              |
| delivery / execution     |                 8 / 6 |      7.710 |      9.089 | `2bdb1694796b`              |
| delivery / trust         |                 8 / 6 |      6.537 |      7.158 | `2bdb1694796b`              |
| delivery / proposal      |               11 / 10 |      7.195 |      7.598 | `e0eb199268b8`              |
| delivery / show-all      |               20 / 14 |     11.321 |     12.849 | `4b76e8443940`              |
| synthetic-60 / overview  |               20 / 59 |     34.565 |     39.502 | `d12ed2ad0759`              |
| synthetic-60 / show-all  |               60 / 60 |     53.754 |     75.420 | `6bc5c6f870d8`              |
| synthetic-240 / overview |              42 / 116 |     43.577 |     44.507 | `ae1f1a217be8`              |
| synthetic-240 / show-all |             240 / 240 |    176.165 |    188.225 | `6b4545e56696`              |

The fingerprint records geometry, not all visual theme/lens markup. Execution and Trust having
the same geometry does not mean their artwork or semantic boundary claims are identical.

The actual Sidecar and td overview models were also measured read-only, with five iterations
after warm-up and the same engine/environment. Only counts, timings, quality metrics, fingerprints
and content revisions are published in the separate [steel-thread baseline](steel-thread-baseline.json);
their source models remain in their owning repositories. No other authored scene data is included.

| Model / view       | Loaded elements / relationships | Visible nodes / edges | Layout median ms | Layout max ms | Geometry fingerprint prefix |
| ------------------ | ------------------------------: | --------------------: | ---------------: | ------------: | --------------------------- |
| Sidecar / overview |                         49 / 48 |               11 / 25 |           18.934 |        24.369 | `775718923c94`              |
| td / overview      |                        77 / 131 |                9 / 50 |           39.304 |        39.931 | `fe87d9db39b70`             |

These are independent single-project layouts, with warm parsed-model caches. Adding the two
times does not predict composition reveal latency. The JSON retains the benchmark's `p95`
field, which is the sample maximum with five observations. Recall cannot be measured before its
model exists. No actual Sidecar/td browser timing was captured in this baseline.

A separate experiment explicitly called `clearModelCache()` before loading delivery, then loaded
the same directory again. The first load in that process took **168.943 ms**. After discarding
that process warm-up, ten cache-cleared loads had **85.027 / 124.832 ms p50/p95**; their immediate
warm counterparts had **0.105 / 1.537 ms p50/p95**. Every pair reported exactly one cache miss,
one hit and one retained entry. This isolates parsed-model caching, not cold disk, process startup,
catalog traversal, network transport or browser paint.

Current invalidation keys use the directory string plus size/mtime stamps of `model.c4`,
`fractal.json` and optional `sequences.json`. Successful parsing returns a content-hash revision;
failed parses are removed from the cache. Phase 1 must add `links.json` to both stamp/revision
coverage and canonicalize path identity. This experiment cleared the cache directly and did not
measure source-edit invalidation latency.

## Browser baseline

The benchmark's readiness request calls `/api/models` before opening the page, priming model
parsing. Page open is therefore a fresh browser and first root geometry render with an already
warm model cache, **not a cold studio startup**. The initial page still requests the catalog,
selected model and render routes. Cold studio startup remains a specific phase 3 measurement.

| Reader operation                         | Median ms | Maximum ms | Samples |
| ---------------------------------------- | --------: | ---------: | ------: |
| Studio page open through visible diagram |     257.0 |      277.0 |       5 |
| Studio expand Order intake               |      63.0 |       63.4 |       5 |
| Studio collapse Order intake             |      47.6 |       48.3 |       5 |
| Studio show all                          |      47.4 |       61.8 |       5 |
| Portable expand Order intake             |      64.1 |       64.2 |       5 |
| Portable collapse Order intake           |      45.9 |       48.1 |       5 |

Each studio observation began with 5 mounted nodes / 8 edges / 188 SVG descendants. Expansion
produced 7 / 8 / 207; collapse restored 5 / 8 / 188; show-all produced 20 / 14 / 385. The exported
portable HTML was 2,027,995 bytes; its DOM counts are independently captured in the raw evidence.

Frame timing was observed over each approximately 400 ms toggle window. The largest reported
toggle-window frame p99 was **45.3 ms in the studio** and **46.7 ms in the portable reader**;
all measured toggle windows reported zero long tasks. These include click/geometry work and
are not pan/zoom measurements. They neither pass nor fail the plan's dedicated pan/zoom gate.
The short windows contain roughly two dozen frames and cannot characterize sustained camera use.

The stock browser benchmark emitted Node's experimental `localStorage` warning during portable
export. It completed successfully in every run; the warning does not represent a browser
measurement or failed export.

## What this evidence changes

Keep the planned budgets as provisional phase 3 gates. Small-model warm interaction is below
100 ms here, while an uncached 240-node local layout already exceeds that figure. Independent
per-project caching and avoiding unrelated internal layouts remain necessary parts of the design.
No number here justifies flattening projects into one graph or adding a second rendering engine.

Composition placement/routing, 20 unopened links, three-project cold reveal, 300/600 pan/zoom,
50 open/close cycles, retained heap/cache bytes and zero foreign parsing are **unmeasured** because
composition does not yet exist. Sidecar/td/Recall source models are not included in public fixtures.
The next slice should retain these single-model fingerprints and add its two-project real
journey through a temporary catalog; phase 3 supplies the remaining scale fixtures and gates.

## Verified steel-thread endpoints

These are source observations from local checkouts, not execution traces of a running Sidecar.
Paths below are relative to their owning repository. Repository revisions at inspection:
Sidecar `5fcfa13c7f0cb86c3c4da6f5f81e7843e3026b88`,
td `ef92de2dc490514df5fe2f20b91d5ad901e635ed`,
Recall `83dc137bb2ed7d1eb05ab5aae3492a0b92755654`.

### Sidecar → td

1. Sidecar `internal/plugins/assembly/assembly.go` registers `tdmonitor.Descriptor()`.
2. `internal/plugins/tdmonitor/plugin.go` imports `github.com/marcus/td/pkg/monitor`.
   `Start()` launches `buildMonitor()`, which supplies `monitor.EmbeddedOptions` and calls
   `monitor.NewEmbeddedWithOptions(opts)`. Adoption initializes the monitor; `Update` and `View`
   delegate to the embedded model. The local integration is in-process. Its remote-host guard
   currently returns without creating a monitor.
3. td `pkg/monitor/model.go` defines `NewEmbeddedWithOptions`, resolves the project base directory,
   acquires the shared database, constructs `NewModel` and marks it embedded.
4. Sidecar's authored `docs/diagrams/fractal/model.c4` has explicit UID `plugins.td`. td's model
   has explicit UIDs `monitor` and `monitor.model`, with descriptions covering embedded use.

The canonical first connection should therefore be:

```json
{
  "id": "td-integration",
  "source": { "model": "sidecar", "element": "plugins.td" },
  "target": { "model": "td", "element": "monitor" },
  "title": "Embeds td monitor",
  "kind": "embeds",
  "status": "current",
  "description": "Sidecar creates td's monitor model in-process and delegates updates and rendering through its embedded monitor API.",
  "evidence": ["internal/plugins/assembly/assembly.go", "internal/plugins/tdmonitor/plugin.go"]
}
```

Use this verified `plugins.td → monitor` mapping for the first authored connection. CLI availability checks and setup flows exist, but they are not the active
monitor's principal integration path. `monitor.model` is a valid more detailed target if the
authored claim is specifically about construction/update/rendering; `monitor` makes a clearer
overview endpoint. The owning Sidecar claim keeps Sidecar-relative evidence; td's node supplies
its own implementation evidence.

### Sidecar → Recall

Recall `internal/cli/sidecarplugin.go` implements `recall sidecar-plugin` as one JSON request on
stdin, one JSON response on stdout and one process per call. It supports `describe`, `resolve`,
`list`, `get` and `act` under `sidecar.plugin/v1`, retaining explicit draft-protocol compatibility.
Its documented configuration uses a `plugins.external` entry with the argument vector
`["recall", "sidecar-plugin"]`.

On the Sidecar side, `internal/app/resourceproviders.go` resolves enabled provider instances,
passes them to `pluginhost.FromInstances`, and installs the manager after the first ready frame.
`internal/pluginhost/command.go` creates protocol requests; `protocol.go` owns the frozen wire
identifier; `runner.go` executes the configured argument vector and manages the process pipes.
`provider.go` explicitly describes this as process isolation, not a sandbox.

This supports a future **Runs Recall plugin protocol** connection from a source-owned Sidecar
Recall integration element to a source-owned Recall CLI/plugin transport element, once those
stable UIDs are authored. Neither a Recall model at `docs/diagrams/fractal/` nor a Recall element
in Sidecar's inspected model exists. Do not invent a foreign UID or copy the td in-process claim
onto Recall. No installed configuration was inspected and no plugin process was run; this proves
the implementation path is available, not that a particular machine has it enabled. Model authoring
and source-owned evidence remain the phase 5 prerequisites described by the controlling plan.

## Reproduce

Run from the Fractal repository. Store fresh outputs in an ignored artifact directory, then keep
only sanitized evidence intended for publication. The following selects public inputs explicitly
and does not read the installed catalog:

```sh
mkdir -p artifacts/linked-phase0
bin/fractal bench --directory examples/delivery --synthetic 60,240 \
  --views both --engine elk-layered --iterations 10 --json \
  > artifacts/linked-phase0/cli.json
npm run build
for run in 1 2 3 4 5; do
  FRACTAL_CATALOG='' FRACTAL_MODELS_DIR="$PWD/examples" \
    node --import tsx scripts/bench-browser.ts --model delivery --skip-build \
    > "artifacts/linked-phase0/browser-$run.json"
done
```

Compare single-model geometry using the committed baseline:

```sh
bin/fractal bench --directory examples/delivery --synthetic 60,240 \
  --views both --engine elk-layered --iterations 10 \
  --baseline docs/plans/active/linked-project-diagrams/phase-0-baseline.json \
  --fail-on-geometry-change
```

If Sidecar and td are sibling checkouts, the read-only real-model measurement is reproducible
with the following command. It measures all authored scenes because the CLI has no single-scene
benchmark filter; retain only `overview` rows when updating the published baseline, and replace
absolute source paths with repository-relative labels before publication.

```sh
bin/fractal bench --directory ../sidecar/docs/diagrams/fractal,../td/docs/diagrams/fractal \
  --views scene --engine elk-layered --iterations 5 --json \
  --baseline docs/plans/active/linked-project-diagrams/steel-thread-baseline.json \
  --fail-on-geometry-change > artifacts/linked-phase0/steel-thread.json
```

The existing comparison table computes **p50 deltas**. Check the stored `stages.*.p95` values
separately when enforcing the plan's p95 regression gate; a passing geometry check is not a
passing performance gate.

Reproduce the isolated cold/warm model-load experiment with the existing cache and percentile
seams (the first process load is reported separately, then ten measured pairs):

```sh
node --import tsx --input-type=module <<'JS'
import { performance } from 'node:perf_hooks';
import { loadDirectory, clearModelCache, modelCacheStats } from './src/lib/server/models.ts';
import { percentile } from './src/lib/bench/index.ts';
const samples = [];
let firstLoadMs;
for (let i = 0; i < 11; i++) {
  clearModelCache();
  const start = performance.now();
  await loadDirectory('examples/delivery');
  const cold = performance.now() - start;
  const warmStart = performance.now();
  await loadDirectory('examples/delivery');
  const warm = performance.now() - warmStart;
  if (i === 0) firstLoadMs = cold;
  else samples.push({ cold, warm, cache: modelCacheStats() });
}
const stats = (key) => ({
  p50: percentile(samples.map(s => s[key]), 0.5),
  p95: percentile(samples.map(s => s[key]), 0.95),
  samples: samples.length
});
console.log(JSON.stringify({ firstLoadMs, cold: stats('cold'), warm: stats('warm'), samples }, null, 2));
JS
```
