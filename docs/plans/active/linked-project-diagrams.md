# Linked project diagrams on one canvas

Status: phase 1 complete, 2026-09-13. Planning task: `td-1c460e`; phase 0: `td-b67c0a`; phase 1:
`td-e673b8`.
The [product plan](fractal.md) controls product scope; this document controls linked architecture
composition. Phase 0 established contracts and evidence; phase 1 delivered the first production slice
(Sidecar → td through the CLI, HTTP and one real canvas); phase 2 starts next.
[DESIGN.md](../../../DESIGN.md) controls visual language;
[layout performance and engines](layout-performance-and-engines.md) controls local geometry and
its existing benchmarks. This plan adds composition measurements and does not replace that seam.

## Outcome and steel thread

A reader opens Sidecar, follows its td or Recall integration, and reveals that project's full,
independently authored architecture beside Sidecar on the same pan/zoom canvas. They expand a
component, inspect a connection across the projects, collapse either project, copy a link, and
export the composition without losing ownership, relationship meaning, or their place.

“Full diagram” means the complete target model is available for exploration. It does not mean
expanding every descendant at once. A linked project's authored overview is its initial view;
its other architecture scenes and full detail remain reachable in place. Additional plugins use
the identical contract. A plugin without a diagram remains a useful local integration element.

The first vertical slice is Sidecar → td. The completion steel thread includes Recall and a third,
fictional plugin to prove there is no Sidecar-specific renderer or plugin registry dependency.

### Evidence inspected and prerequisites

- `src/lib/core/types.ts`: `Model`, `ViewState`, element parents and relationship endpoints are
  single-model values. Boundary membership already differs from structural parentage.
- `src/lib/core/projection.ts`: visibility, collapse representatives, outside-scope connections,
  and `underlying` relationship IDs are shared core behavior worth reusing.
- `src/lib/core/measure.ts`, `layout.ts`, `layout-engine.ts`, and `adapters/layout/`: measured
  content precedes engine placement. Retain this pipeline separately for each visible project.
- `src/lib/server/models.ts`: catalog resolution currently validates every entry; parsed models
  use a bounded cache, file stamps, and content-hash revisions. An invalid unrelated catalog entry
  can currently prevent loading a healthy project. Lazy linking needs targeted resolution.
- `src/lib/server/render.ts`, `cache.ts`: diagrams are cached by model revision and canonical view,
  with a 64-entry bound. The bound counts entries, not bytes.
- `src/routes/+page.svelte` rejects superseded render responses with a request counter;
  `api/render/+server.ts` checks one revision. Composition needs a revision vector and per-project
  request ownership. `DiagramCanvas.svelte` currently renders all projected SVG nodes and edges.
- Sidecar's `docs/diagrams/fractal/model.c4` contains stable `plugins.td`; its
  `internal/plugins/assembly/assembly.go` registers `tdmonitor.Descriptor()`. td's model contains
  `monitor` and `monitor.model`. Phase 0 verified that tdmonitor calls
  `monitor.NewEmbeddedWithOptions` and delegates Update/View in process; the precise bridge is
  `sidecar/plugins.td` → `td/monitor`, “Embeds td monitor,” rather than a CLI invocation.
- Recall implements `recall sidecar-plugin` in `internal/cli/sidecarplugin.go`, with the
  `sidecar.plugin/v1` protocol. No `docs/diagrams/fractal/` exists in the inspected Recall checkout,
  and Sidecar's inspected model has no Recall element. These are model-authoring prerequisites,
  not evidence that Recall lacks plugin support. No sibling repository is changed by this plan.

Keep real repository models in their owning repositories. Public tests use small fictional fixtures;
local proof can use temporary catalogs and model copies. Model-authoring changes in sibling repos
must be executed in those repos under their instructions, not by Fractal core work.

## Design decisions

1. **Compose projects without merging their source models.** Each project retains its hierarchy,
   scenes, memberships, IDs and provenance. A project frame is presentation geometry, never a
   synthetic parent element, deployment boundary, or claim of trust enforcement.
2. **References are explicit, repository-owned claims.** Put an optional versioned `links.json`
   beside `model.c4` and `fractal.json`. This avoids extending LikeC4 grammar or overloading its
   single-model relationships. Local relationships stay in LikeC4; only cross-model claims belong
   here. The loader must preserve and validate this file across CLI, server and portable export.
3. **Resolve through configured local catalogs first.** Authored links identify a model, never an
   absolute path. A resolver adapter maps model IDs to available snapshots. No cloning, network
   fetch, execution of plugin commands, or filesystem discovery is implied by opening a link.
4. **One visible instance per project in a composition.** Multiple integrations may connect to the
   same target frame. Repeat project views at different revisions, arbitrary freeform frames and
   architecture/sequence comparisons remain the separate [workspace idea](../planning/multi-diagram-canvas.md).
5. **Layout locally, compose globally.** Reuse existing layout engines inside each project. Place
   project rectangles and route bridges in a separate composition stage. Do not send a flattened
   multi-repository graph to ELK on every toggle.
6. **Keep semantic state separate from rendering savings.** A collapsed project is shareable view
   state. Offscreen culling and low-zoom label reduction are local rendering choices and must not
   remove claims from inspection or exports.
7. **Live references by default, exact artifacts when exported.** Permalinks reproduce view intent
   against current sources; they are not archival revision locks. Portable exports embed the
   explicit included snapshot set and revision manifest, with no runtime repository access.

## Authoring and identity contract

`links.json` contract (parsed by the phase 0 library; not yet consumed by the model loader or studio):

```json
{
  "version": 1,
  "links": [
    {
      "id": "td-diagram",
      "from": "plugins.td",
      "target": { "model": "td", "scene": "overview" },
      "title": "td architecture"
    }
  ],
  "connections": [
    {
      "id": "td-integration",
      "source": { "model": "sidecar", "element": "plugins.td" },
      "target": { "model": "td", "element": "monitor" },
      "title": "Embeds td monitor",
      "kind": "embeds",
      "status": "current",
      "description": "Constructs the embedded td monitor and delegates its update and view lifecycle in process.",
      "evidence": ["internal/plugins/tdmonitor/plugin.go"]
    }
  ],
  "compositions": [
    {
      "id": "plugins",
      "title": "Sidecar and its plugins",
      "rootScene": "overview",
      "projects": [{ "model": "td", "scene": "overview", "mode": "open" }]
    }
  ]
}
```

A diagram link is a navigation affordance; it is not itself a software dependency. Connections
are separately authored, directed architecture claims. Link `from` is an existing local stable UID;
a root-level link may omit it. Connection endpoints must use explicit stable UIDs (require them,
not LikeC4's generated fallback identities). The LikeC4 adapter currently discards whether an ID
was explicitly authored: add identity-origin metadata to the loaded snapshot (including element
and relationship maps) so link validation can enforce this rule without guessing from ID spelling.
Keep that metadata adapter-neutral and available to CLI, server and portable validation. Test an
explicit UID equal to the LikeC4 source ID against a fallback ID; single-model imports without
explicit UIDs remain valid.
At least one endpoint belongs to the authoring model;
each foreign model must be declared by a link. The authoring project owns the connection and its
repository-relative evidence. A local plugin adapter and the foreign project's component remain
separate elements even if their names are similar. Do not silently replace or equate them.

Use structured `{model, element}` references in public contracts. Internally key entities by a
canonical encoded tuple including entity kind; never concatenate IDs with an ambiguous delimiter.
Relationship identity is `{ownerModel, connectionId}`; local relationship IDs, boundaries, scenes,
selection and evidence are similarly qualified where they cross a composition boundary. Namespace
DOM/SVG node IDs, accessible title references, clip paths, markers, filters and fragment URLs too,
or deliberately share identical drawing definitions. Test colliding local IDs in live and exported
artwork; model qualification alone does not prevent SVG collisions. Moving a
repo or reparenting an explicitly identified node leaves links intact. Renaming a model ID requires
an explicit authored migration; titles, paths and catalog ordering must never select an identity.

Load links transitively only when that project is explicitly opened. An A → B → A cycle reuses A's
existing frame, and a diamond reuses its target. Duplicate local link/connection IDs are errors.
Independent reverse or repeated claims retain both owners and provenance; do not deduplicate by
endpoints alone. A configured catalog resolves exactly one directory per model ID. A worktree
preview uses an alternate catalog; two revisions of one ID cannot coexist in the first version.

`links.json` absence means existing single-project behavior. Its presence participates in model
stamps and revision hashing. Unknown versions or fields fail with precise JSON paths. Document the
minimum reader version: older readers may ignore a sidecar file, so artifacts and tooling must
advertise that linked composition requires a capable reader. Never report a successful complete
composition when an incompatible consumer rendered only the root.

## Shared composition state and core

Add a separate `CompositionState` rather than changing the meaning of existing `ViewState`:

- version, root model, optional authored composition ID;
- nonempty, unique project entries, root first, with model ID, `open | collapsed`, and resolved
  per-project visibility/scope state;
- qualified selection; shared theme and layout-engine ID; optional focused project;
- no filesystem paths, DOM state or loader handles.

Apply shared theme/layout to each local layout for a coherent first release. Direction remains
a property of the existing layout-engine ID; reject per-project theme/layout overrides. Per-project scene
selection supplies scope/expansion/proposal/lens defaults; explicit saved view overrides those
fields. Keep proposal visibility per project and require both endpoints and the claim to be eligible
before drawing a bridge. A proposed connection is eligible only when its owning project's
`proposed` switch is on, in addition to endpoint eligibility under each endpoint project's view.
The owner is always a participating project; its collapsed state retains that view. The owner's
switch never overrides a hidden proposed endpoint in another project. A focused scene with an excluded endpoint yields an inspectable outside
connection, not a silently changed scope. Root ordinary URLs and exports remain unchanged unless
composition is explicitly selected. Share composition state through a versioned encoded URL value;
reject malformed/oversized payloads with a useful diagnostic rather than partially applying them.

New core modules should be a small `src/lib/composition/` family: types/parse, resolution contract,
projection, placement/routing, inspection and serialization. Resolution I/O belongs in adapters;
core consumes immutable snapshot records. A composed diagram contains local diagrams, frame
transforms, projected bridges and diagnostics. Existing single-model `layout()` remains callable
and its geometry fingerprints remain unchanged.

The application boundary offers resolve, project, layout, inspect, search and export operations.
The browser and CLI reach those operations; routes translate inputs and outcomes. A request carries
a vector of participating revisions plus a composition generation. Loading an unopened target adds
its revision only after successful validation. If an already participating source changes, return
`revision_changed` and offer explicit reload; do not silently mix its new model with old geometry.
Reload verifies stamps around the read, retries once for concurrent writes, then returns a useful
`source_changing` diagnostic. Cancelled or older generations never replace new state.

## Boundary and connection presentation

One continuous camera covers all project frames. A subtle perimeter and a title on the canvas
identify each project; use current theme tokens, generous measured title clearance, and no nested
application toolbar. Project identity stays visible in ordinary Structure view. Trust memberships
remain a distinct optional lens within each frame, never inherited from Sidecar by a plugin.
Do not reuse dashed proposed styling to mean “another repository,” or use color as the only signal.

Open a linked diagram from its local element's inspector or keyboard-accessible outline action.
Reveal the target beside the source, preserve current scale and the source title's screen position,
and keep Sidecar visible. Once open, repeated activation reveals the existing project. Project
collapse leaves a titled summary and connection anchors; expanding restores its last view. Closing
a linked frame removes it from the composition but keeps its authored link available at the source.
A project menu provides scene selection, focus, collapse, close and opening its standalone diagram;
root close returns to ordinary root view. Explicit Fit all or Fit project is the only automatic zoom
request. Desktop, touch, reduced motion and keyboard actions must reach the same state transitions.

Route bridges from the actual visible representative of each qualified endpoint. When an internal
ancestor is collapsed, use that ancestor; when an entire project is collapsed, use its summary.
For an endpoint outside the selected scene scope, use a labeled project perimeter port with an
outside-scope count and a reveal action. Keep such ports visually distinguishable from components.
A missing or invalid target uses an unavailable reference card, never a fabricated component.

Bridge routes have segments inside the endpoint projects and a corridor between project perimeters.
Measure labels, reserve perimeter port spacing, avoid node cards, project headers and unrelated
frames, and retain arrow direction at every detail level. Bundling is permitted only for identical
visible representatives, kind, status, title and description; preserve qualified underlying claims
and display a count for multiples. Inspection leads with readable project/component routes, then
claim description, exact endpoints and source evidence. No merging of unrelated claims to reduce
clutter. Offscreen edges are culled by route bounds, including edges whose endpoints are offscreen
but whose path crosses the viewport.

Keyboard spatial navigation uses composed coordinates; outline/search can select unmounted nodes
and reveal/mount them before restoring focus. Register actions in `core/shortcuts.ts`. Maintain one
inspector, one navigation panel and one camera. UI chrome is excluded from SVG/PNG artwork.

## Resolution, errors and portability

Split catalog parsing from targeted entry validation. Opening root A validates A; opening B validates
B. Listing projects reports each unavailable entry without preventing healthy entries from loading;
explicit catalog validation still reports every failure. Broken catalog JSON or duplicate IDs are
fatal configuration errors. Root errors block composition; target errors preserve the root and other
healthy projects. Do not scan or parse every catalog model to discover whether a link exists. Change the studio's
initial `/api/models` path as well: it currently calls `listProjects()` and compiles the whole
catalog. Supply picker titles from lightweight companion metadata with per-entry diagnostics;
full compilation happens only for selected targets or explicit catalog validation. This is an
intentional change to catalog-list validation behavior, and needs a focused regression test.

Return typed diagnostics with owner, link/connection ID, target and recovery action:

| Condition                                 | Reader behavior                                 | Agent/validation behavior                                  |
| ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Model not registered or directory missing | Unavailable card; register/retry guidance       | `model_unavailable`                                        |
| Target invalid or unsupported version     | Card explains unavailable source                | `model_invalid` / `unsupported_version`                    |
| Missing scene or element                  | Preserve claim and explain broken reference     | `scene_missing` / `endpoint_missing`; no fallback by title |
| Revision changed                          | Keep last coherent view visibly awaiting reload | `revision_changed`                                         |
| View exceeds resource budget              | Keep previous view; offer collapse/focus        | `budget_exceeded` with counts and limit                    |
| Target only links back to an open project | Reveal that frame                               | Successful deduplicated resolution                         |

Distinguish an unopened link (`not_loaded`) from a failed resolution (`unavailable` or `invalid`).
Unopened links use their authored label and target ID, without asserting availability. Render their
cross-project claims as reference stubs at the source; a stub says “diagram not opened” and does not
invent a target component. Only explicit opening or validation resolves the target. Connections
from opened projects back to a closed target remain authored claims, represented by these stubs.
Closing a project removes its contributed outgoing claims from the active composition, while claims
owned by remaining projects remain inspectable. Unrelated unopened links never become export errors.

Interactive unresolved references are nonfatal diagnostics. Local validation checks syntax and local
UIDs without requiring other repos; strict linked validation resolves the declared link closure with
visited-set deduplication and returns nonzero for unresolved claims. Enforce traversal budgets in both.
Use configured catalog entries only at the server boundary; never accept arbitrary directories or
URLs from HTTP. CLI `--directory` remains an explicit local entry point. Canonicalize resolved paths
for cache identity. Treat evidence as inert text/links and escape model content in all renderers.

SVG/PNG export uses the exact requested composition and projected omission indicators, independent
of viewport culling. Exports validate endpoints for participating targets, but do not resolve unopened links outside
the requested composition. Unopened reference stubs are intentional omissions in SVG/PNG and the
manifest; a failed participating target is unresolved. Unresolved exports fail by default; explicit `--allow-unresolved` produces visible
unavailable cards and a diagnostic manifest. HTML export requires an explicit included project set:
root plus selected linked projects. Embed their full models, scenes, evidence and link manifests;
report that scope before writing, because a scene is not a publication filter. Links to excluded
projects remain unavailable offline and never cause a network fetch. Embed a versioned revision
manifest and reuse the composition core with the existing portable layout-worker approach. A bundle
is a snapshot and does not update when repositories change. Imported snapshots are read-only.

## Performance strategy and acceptance budgets

Measure the actual current baseline before implementation; historical single-model measurements in
the layout plan are context, not proof for this feature. Record machine, browser, build, seed, model
counts, visible counts and cold/warm cache state alongside p50/p95 and browser frame p99.

1. Load root immediately. Fetch/parse foreign models only on explicit reveal or saved open state,
   with at most two concurrent resolutions/layout jobs initially. No speculative recursive loading.
2. Cache per-project parse and local layout by revision/view/engine/metrics version. Cache composition
   placement by ordered frame sizes, projected bridges and composition options. Expanding td may
   resize/place frames and reroute bridges, but must not rerun Recall's internal layout.
3. Keep deterministic automatic frame placement for canonical CLI/export output. Interactive
   expansion translates the composition camera to preserve the toggled title at its screen position;
   avoid adding remembered placement as hidden input to canonical geometry. A later manual-placement
   engine can own explicit coordinates if real use demands it.
4. Coalesce rapid requests and discard obsolete responses. Bound work queues, model bytes, visible
   geometry and cache bytes as well as counts. Use LRU eviction of unmounted project artifacts;
   retain small semantic view records. Instrument hits, misses, jobs and retained estimated bytes.
5. Add viewport culling for project contents and bridge geometry with an overscan margin. Keep
   project outlines and focused elements available. At low zoom omit descriptions/secondary labels
   locally, without changing layout or source semantics. Never run projection or layout on pan/zoom.
6. Reuse the portable worker seam. If measured parse/projection/placement creates main-thread long
   tasks, move that stage to a worker too; do not introduce a new renderer before evidence demands it.

Initial release targets below are proposed gates to confirm against the baseline in slice 0.
Changes to targets require recorded measured justification, not silently dropping a difficult case.

| Journey/load                                          | Gate on the recorded reference machine                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Root with 20 unopened links                           | Zero foreign parses/layouts; first useful paint <= 10% slower than root-only baseline      |
| Sidecar + td + Recall warm local toggle               | p95 input-to-geometry <= 100 ms; unrelated project layout calls = 0                        |
| Cold target reveal, <= 500 elements / 1,000 relations | p95 <= 1 s; busy feedback by 150 ms; pan/zoom remains responsive                           |
| Pan/zoom, <= 300 visible nodes / 600 visible edges    | Frame p99 <= 25 ms; zero composition-induced main-thread tasks > 50 ms                     |
| Repeated open/close, 50 cycles                        | After warm-up/GC where supported, retained heap growth <= 10%; caches remain within bounds |
| Single-project compatibility                          | Same geometry fingerprint and <= 10% p95 regression over baseline                          |

Start with limits of 20 participating projects, 10,000 total loaded elements, 20,000 relationships,
500 visible nodes, 1,000 visible edges, 5 MiB source bytes per project, and 128 MiB estimated cache
payload. Include bridge geometry and in-flight responses in resource accounting. These are admission
limits, not promises that every graph below them meets latency targets. Exceeding a limit returns a
shared diagnostic and keeps the last successful view; do not silently truncate or raise a limit via
an untrusted URL. Service/CLI configuration owns overrides. Export checks the same limits before
allocating output; larger exports need explicit local override and a measured run. If a single model
exceeds its limit, offer a smaller authored model; scene filtering cannot avoid full-source parsing.

Extend `bin/fractal bench` and `scripts/bench-browser.ts` instead of starting another benchmark stack.
Fixtures: real local steel thread; 20 unopened links; 3 × 100 visible nodes; 10 projects with 1,000
loaded elements each but collapsed views; dense cross-project bridges; a deep chain, cycle and diamond;
long labels and overlapping trust memberships. Time resolve, parse, local projection/measure/layout,
frame placement, bridge routing, serialization and paint separately. Report cache bytes, DOM counts,
rejected work and fingerprint/quality metrics. Benchmark current SVG before deciding on Canvas/WebGL.

## CLI, HTTP and portable parity

The following commands and routes are proposed additions, not claims of shipped capability.
Keep current single-project commands unchanged; `--composition ID` selects authored composition,
and `--composition-state FILE` supplies an explicit versioned state (mutually exclusive).

| Owned capability                       | CLI                                                                                | Studio / existing HTTP service                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Discover links and resolution status   | `fractal links --model sidecar --json`                                             | Linked diagrams in inspector; GET `/api/composition/links?model=sidecar`                       |
| Validate local / full declared closure | `fractal validate --model sidecar [--linked] --json`                               | Shared diagnostics via POST `/api/composition/validate`                                        |
| Resolve/project/layout composition     | Existing `project` / `layout` with composition selector and `--json`               | POST `/api/composition/render`; shared core                                                    |
| Inspect qualified node/claim           | Existing `inspect` with composition selector and qualified JSON selection          | Inspector consumes same composed inspection result                                             |
| Search participating models            | Existing `search` with composition selector and `--json`                           | Jump search with project-qualified results; unopened targets are searchable link metadata only |
| Save/replay exploration                | Versioned composition state file and existing link serialization                   | Permalink; optional authored `compositions` in `links.json`                                    |
| Export                                 | Existing `export` with composition selector, inclusion options and `--json` report | Same exporter through `/api/export` extension                                                  |
| Measure                                | Existing `bench` with composition selector                                         | Browser benchmark invokes real routes and gestures                                             |

CLI returns deterministic ordering and structured diagnostics; fatal invalid input/unresolved strict
validation or export exits nonzero. HTTP maps invalid state to 400, revision conflicts to 409 and
resource limits to 422; recoverable target failures remain successful composition results with
explicit diagnostics. No separate MCP server or UI authoring framework is needed. Authors edit
inspectable files; authoring validation and resolution never live solely in components.

## Dependency-ordered delivery

Each slice includes focused checks and a working surface journey. Track implementation in td when
execution begins; do not mark implementation complete because this plan is complete.

### 0. Freeze contracts and establish evidence — complete

Evidence and phase 1 handoff: [phase 0 record](linked-project-diagrams/phase-0.md).
The library contracts, fictional fixtures, baseline fingerprints, verified integration endpoints and
interactive proposal are delivered. This completes phase 0 only; the production resolver, loader,
canvas and exports remain in their respective slices below.

Record baseline numbers and fingerprints. Create fictional host + plugin fixtures with intentional
UID collisions; verify current local Sidecar/td integration paths. Produce a small visual proposal
showing open/collapsed projects, Trust on, a bridge and an unavailable target in the existing studio
language. Confirm `links.json`, qualified identities, diagnostics and state parsing with example
contract tests before broad UI work. Review the design against this plan; record any amendments.

### 1. Sidecar → td through CLI and one real canvas — complete

Evidence and phase 2 handoff: [phase 1 record](linked-project-diagrams/phase-1.md).

Implement sidecar-file parsing, targeted catalog resolver, stable reference validation and shared
composition result. Add CLI layout/inspect and HTTP render wiring, two project frames and one bridge.
Prove open td from Sidecar, expand td, inspect actual endpoints and return to Sidecar at the same
scale. Preserve local model fingerprints; no synthetic structural parents. Use temporary copies
until source-owned model changes are ready in their own repositories.

### 2. Complete meaning and failure behavior

Add project collapse/reveal, scene/scope changes, qualified search/selection/permalinks, omitted
endpoint ports, claim aggregation and revision conflict/reload behavior. Test cycle/diamond reuse,
missing diagrams, broken target UIDs, duplicate catalog IDs, one malformed unrelated model and
proposed/current visibility (including mismatched owner/endpoint switches and reverse-owned claims).
Only scope exclusion yields outside-scope ports; proposal exclusion hides the claim. Complete CLI/HTTP parity and keyboard/touch access. Do not claim full
link support after a two-project rendering demo alone.

### 3. Bound work and prove scale — complete

Evidence and phase 4 handoff: [phase 3 record](linked-project-diagrams/phase-3.md). The
composition fixture matrix, the real three-project steel thread, the browser journey and the gates
table are recorded there; the [sanitized baseline](linked-project-diagrams/phase-3-baseline.json)
and [browser journey](linked-project-diagrams/phase-3-browser.json) carry the raw measurements.

Add targeted invalidation, queue/cancellation ownership, byte bounds, culling and low-zoom detail.
Extend benchmarks and run the fixture matrix. Address failures within the existing engine/renderer
seams; rerun only affected checks and the release gates. Include the real cold studio startup and its catalog request in the zero-foreign-parses check.
A target edit invalidates that target and
bridge composition, while healthy unrelated local layout cache entries survive.

### 4. Exports and portability

Implement combined SVG/PNG and explicit-set portable HTML snapshots, manifest/error behavior and
shared-state replay. Verify exported artwork includes offscreen content and omission claims, stable
bridge direction, readable labels and project identities in all themes. Open the HTML offline and
expand both projects; excluded or unavailable links remain honest placeholders.

### 5. Complete the real steel thread and documentation

In source-owned follow-on work, author Recall's model from inspected code, add Sidecar's Recall
integration element/link and precise connection claims, and verify td's endpoint contract. Confirm
both full models are explorable together; add the fictional third plugin by authoring only. Update
model-format, catalog, portable HTML and usage guides, CLI help, shortcuts, DESIGN.md and the
product plan to reflect shipped behavior. Keep actual repository diagrams out of public fixtures.

For application implementation completion: `npm run check`, `npm test`, `npm run build`, focused
browser and offline export proof, and the composition performance gates. Obtain independent review
of model identity/projection, boundary semantics and layout; record reviewer and resolved findings.
Reinstall an installed local studio with `bin/fractal service install`, then verify
`bin/fractal service status --json` and the actual Sidecar journey. Use an isolated browser/catalog
for disruptive proof. Never restart the default tmux server. Documentation-only planning needs
link/diff checks, not a service reinstall or application test run.

## Completion checklist and handoff

- [ ] Complete Sidecar → td → Recall journey, including absent-diagram recovery and third plugin.
- [ ] Qualified identity, cycle/diamond, source ownership and proposed-state tests pass.
- [ ] Every collapse/scope state preserves exact inspectable bridge provenance.
- [ ] Catalog isolation and stale-response/revision conflicts have process-level proof.
- [ ] CLI, HTTP, permalink and portable reader agree on projection and diagnostics.
- [ ] Reference-machine performance gates and bounded-memory proof recorded.
- [ ] Light/dark, keyboard, narrow viewport, reduced-motion and export artwork reviewed.
- [ ] Source-owned guides/models updated, independent reviewer recorded, installed studio verified.

Remaining product exploration is deliberately separate: arbitrary spatial workspaces, multiple
instances/revisions of a project, sequence-to-architecture bridges, remote URL/Git resolution,
automatic plugin discovery, inferred cross-repo dependencies and live collaborative editing.
None is required to finish linked architecture composition. The resolver and identity seams keep
those additions possible without making them prerequisites.

Planning review completed by independent agent `/root/review_plan` on 2026-09-13. Findings on
explicit identity provenance, eager catalog parsing, proposed-claim ownership, unopened/export
semantics and SVG identity collisions are incorporated; final review found no planning blockers.
Markdown links, JSON examples and formatting checked. No application or sibling-model changes in
the planning task.
