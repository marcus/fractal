# Final independent review — linked project diagrams (td-430710)

Repository: `~/code/fractal`, branch `main`, reviewed at `95adfb8`
(docs-only commits `43d2a0c`/`e03081e`/`f8448e1` landed during the review; no source changed).
Reviewer: independent agent session `ses_2aebc5`, context `reviewer-td-430710`, 2026-09-14.

Scope: model identity/projection, boundary semantics and layout, per the controlling plan's
completion step. Read: `docs/plans/implemented/linked-project-diagrams.md`,
`docs/guides/active/linked-project-contract.md`, `docs/plans/implemented/linked-project-diagrams/phase-1.md`,
all of `src/lib/composition/*.ts`, `src/lib/server/composition.ts`, `src/lib/server/models.ts`,
`src/lib/server/export.ts`, `src/lib/adapters/likec4.ts`, `src/lib/adapters/html.ts`,
`src/lib/portable/document.ts`, `src/routes/api/**`, `scripts/fractal.ts`, the studio
composition components, and `tests/fixtures/linked-projects/**`.

Method: read-only. Reproductions were written as `tests/scratch-*.test.ts` and as a temporary
catalog in the session scratchpad over the **real** `sidecar` / `td` / `recall` model directories
(read-only); all scratch files were deleted afterwards. `git status` is clean.
`npm run check` → 743 files, 0 errors, 0 warnings. `tests/composition-rules.test.ts` and
`tests/composition-compose.test.ts` → 33/33 pass.

## Verdict: **Bigger issue**

The core's identity, ownership, bundling, proposal, collapse and stub semantics are sound and are
consumed (not reimplemented) by the studio, CLI, HTTP and portable reader. But the composition's
_routing_ rule is only satisfied for two adjacent frames, and it is violated by the shipped
three-project steel thread (Sidecar + td + Recall) that the authored `plugins` composition now
produces. Four further real defects (limits bypass on linked HTML export, identity by directory
name in models-directory catalogs, a target's stale view destroying the whole composition, and a
proposal-inconsistent stub) sit behind it. None is a redesign; all are local fixes plus tests.

---

## Finding 1 — Bridges cross unrelated frames, their node cards and (with a collapsed frame) their title bands

**Where**: `src/lib/composition/route.ts:81-90` (`routeBridge`, horizontal branch) with
`src/lib/composition/route.ts:42-44` (`corridorX`) and `src/lib/composition/place.ts:73-100`
(`placeFrames` lays every frame in one row/column in state order).

**Rule violated**: plan, _Boundary and connection presentation_: "Bridge routes have segments
inside the endpoint projects and a corridor between project perimeters. Measure labels, reserve
perimeter port spacing, **avoid node cards, project headers and unrelated frames**". Phase 1's
evidence table claims "Bridges never cross a title band; label in the corridor".

**Reproduction (real models, the shipped steel thread)**: temporary catalog over
`~/code/sidecar|td|recall/docs/diagrams/fractal`, then
`composeFromSelector('sidecar', { composition: 'plugins' })` — equivalently
`bin/fractal layout --model sidecar --composition plugins --catalog <temp>`:

```
frames  sidecar {x:0,     w:3394.54, h:979.5,  titleH:52}
        td      {x:3466.54,w:3352.81, h:1922,   titleH:52}
        recall  {x:6891.35,w:1171.69, h:491,    titleH:52}
bridge  sidecar/recall-integration
        [{2029.89,259} → {5142.94,259} → {5142.94,297} → {7365.4,297}]
        label {5142.94, 278}
  vs unrelated td: segments crossing frame = 3
                   label inside frame = true
                   node cards crossed = ['store']
```

The corridor x for a non-adjacent pair is the midpoint between the two frames, which always lands
inside every frame placed between them. With the root collapsed
(`sidecar` collapsed, `td` and `recall` open) the same bridge additionally crosses **td's title
band** (2 segments) — the invariant the plan states outright:

```
✖ sidecar/recall-integration crosses the td title band (2 !== 0)
```

The existing guards cannot see this: `tests/composition-compose.test.ts:493` uses two frames, and
`tests/composition-rules.test.ts:715` uses three but asserts only
`label.x > left.frame.right && label.x < right.frame.x`, which a label sitting inside the middle
frame satisfies.

Surfaces also disagree on the symptom: `CompositionCanvas.svelte:591-603` draws frames → bridges →
project content, so the stray bridge is hidden _behind_ td's cards (and its 16px hit path still
steals clicks in td's empty areas); `src/lib/composition/svg.ts:273` draws bridges _after_ all
project layers, so the export paints the line and its label _over_ td's content.

**Suggested fix**: make the corridor obstruction-aware. In `routeBridge`, when the chosen corridor
x (or the direct segment) intersects any frame that is neither endpoint, escape to a lane outside
every intervening frame — the mirror of the existing `escapeX` used for the stacked case (e.g.
`y = max(frame.bottom) + gap/2` for frames between the endpoints, entering/leaving each endpoint on
its facing side). `routeBridge` needs the other frames passed in for that. Then strengthen the
three-frame test to assert, for every bridge, zero segment crossings of any _non-endpoint_ frame
and that `label` is outside every non-endpoint frame — for both engines and for collapsed/open
combinations of each project.

---

## Finding 2 — Linked HTML export never checks composition admission limits

**Where**: `src/lib/adapters/html.ts:118-166` (`exportLinkedDocument` calls
`compose()` directly), reached from `scripts/fractal.ts:387-419` and
`src/routes/api/export/+server.ts:181-208`. `checkAdmission` runs only inside
`composeFromSelector` (`src/lib/server/composition.ts:782`), which the HTML path never calls.

**Rule violated**: plan, _Performance strategy_: "Export checks the same limits before allocating
output; larger exports need explicit local override and a measured run." The contract guide says
the export boundary "composes through `composeFromSelector` (so admission limits are checked before
any output is allocated)" — true for SVG/PNG only.

**Reproduction**: with `FRACTAL_COMPOSITION_LIMITS={"loadedElements":5}` over the real catalog:

```
exportComposition('sidecar', {composition:'plugins'}, {format:'svg'}) → BudgetExceededError
exportLinkedDocument(sidecar, {include:['td','recall'], …})          → ALLOWED
    included ['sidecar','td','recall'], 148 loaded elements embedded
```

**Suggested fix**: route the linked HTML export through the same admission gate — either compose it
via `composeFromSelector` (it already builds an explicit `CompositionState`), or call
`checkAdmission(admissionCounts(...), effectiveLimits(options), root)` in `exportLinkedDocument`
before building the document, and map the refusal to CLI nonzero / HTTP 422 like the other export
formats. Add a limits test beside `tests/composition-limits.test.ts` covering `format: 'html'`.

---

## Finding 3 — In models-directory catalogs a _directory name_ selects a model identity

**Where**: `src/lib/server/models.ts:115-140` (`validateEntry` checks `fractal.json.id === entry.id`
only when `catalog.kind === 'catalog'`), `src/lib/server/models.ts:397-424` (`catalogResolver`
never compares the loaded `model.id` with the requested id), `src/lib/server/models.ts:455-462`
(`loadModel` compares only for `kind === 'catalog'`). `catalogReloader` (`:432-453`) has the same
gap. `ProjectSnapshot.id` is documented as "Catalog ID; **always equal to** `model.id`"
(`src/lib/composition/snapshot.ts:10`).

**Rule violated**: plan, _Authoring and identity contract_: "A configured catalog resolves exactly
one directory per model ID … **titles, paths and catalog ordering must never select an identity**."

**Reproduction**: a `FRACTAL_MODELS_DIR` holding `host/` (the Harbor fixture) and a directory named
`plugin/` that actually contains the **Relay** model (`fractal.json` id `third`):

```
links --model host        → [{model:'plugin', status:'resolved'}, …]
validate --model host --linked → the host→plugin link is reported VALID
composed projects         → [['host','Harbor host'], ['plugin','Relay plugin']]
bridges                   → host/call  host:cli → plugin:cli   (diagnostics: [])
```

The authored claim `host:cli → plugin:cli` silently binds to a component of a different model that
merely happens to expose the id `cli`, selected purely by the directory's name; `snapshot.id`
(`plugin`) and `snapshot.model.id` (`third`) disagree, breaking the documented invariant that keys
the revision vector, the composed cache key and every qualified selection. `FRACTAL_MODELS_DIR` and
the `examples/` fallback are supported modes (`docs/guides/active/architecture.md:37`).

**Suggested fix**: enforce the identity check for **every** catalog kind — in `catalogResolver` /
`catalogReloader`, after `loadDirectory`, return
`{status:'invalid', code:'model_invalid'}` when `snapshot.id !== requested`; make `loadModel` throw
regardless of kind. Add a loader test for a models-directory entry whose companion id differs.

---

## Finding 4 — A stale view in a _target_ project destroys the whole composition, untyped

**Where**: `src/lib/composition/compose.ts:356-372` calls `layout()` per project, and
`src/lib/core/projection.ts:31-34,49-51` throws `Unknown expanded element`, `Unknown scope`, or
`Scope is hidden by proposal filter`. No catch, no diagnostic; `POST /api/composition/render`
catch-all answers **400** (`src/routes/api/composition/render/+server.ts:103`).

**Rule violated**: plan, _Resolution, errors and portability_: "Root errors block composition;
**target errors preserve the root and other healthy projects**", and the diagnostics table's
"Missing scene or element → Preserve claim and explain broken reference (`endpoint_missing`)".
Compare the missing-_scene_ path, which is diagnosed and falls back
(`src/lib/composition/compose.ts:338-354`). `src/lib/composition/state.ts:169-178` even promises
"Existence is checked when the composition next composes".

**Reproduction** (fixtures; the same happens with any replayed permalink after a target edit):

```
state: host open, plugin open with view.expanded = ['core-renamed']
compose(...) → Error: Unknown expanded element: core-renamed
               at project (src/lib/core/projection.ts:32)
               at compose (src/lib/composition/compose.ts:366)
```

and with `view.scope: 'does-not-exist'` → `Error: Unknown scope: does-not-exist`. Both are exactly
the shape a saved `--composition-state` / `?composition=v1.…` permalink produces once the target
model renames or removes an element — the state parser and codec accept any element id by design.

**Suggested fix**: sanitize each project's view against its snapshot before `layout()` — drop
unknown `expanded` ids and an unknown or proposal-hidden `scope`, emit `endpoint_missing`
(recovery `repair`) naming the owning project and path, and keep composing. A failure in the
**root's** view may still block; a target's must not.

---

## Finding 5 — A claim whose local endpoint is hidden by proposal still draws a reference stub

**Where**: `src/lib/composition/compose.ts:476-498` (the unopened-target stub loop checks only
`connection.status === 'proposed' && !project.view.proposed`), versus
`src/lib/composition/compose.ts:407-430` (the drawn-bridge path, which also calls
`endpointProposedHidden` for both endpoints).

**Rule violated**: plan, _Shared composition state and core_: "Keep proposal visibility per project
and require both endpoints **and** the claim to be eligible before drawing a bridge"; the type
comment on `HiddenClaim` says proposal exclusion hides the claim.

**Reproduction** (fixture `third`, whose `beta` element is proposed; the `future` claim re-authored
as `status: 'current'`, `plugin` not participating, `third.view.proposed = false`):

```
beta drawn = false
stub        = { owner:'third', connectionId:'future',
                anchor:{model:'third', element:'beta'},
                target:{model:'plugin', element:'cli'}, state:'not_loaded' }
hidden      = []
```

The stub advertises a claim anchored to an element that the view deliberately hides; because the
anchor node is absent, `stubOrigin` (`src/lib/composition/svg.ts:84-96`) falls back to floating the
card below-right of the frame. With the same target **opened**, the identical claim is correctly
reported as `hidden`.

**Suggested fix**: in the stub loop, also skip (and record as `hidden` with reason
`proposed-endpoint`) when `endpointProposedHidden(ownerSnapshot, project, localEndpoint)` is true.

---

## Finding 6 — Qualified selections that search, state and the codec produce cannot be inspected

**Where**: `src/lib/composition/inspect.ts:235` —
`throw new Error('Selection kind ${kind} is not supported in phase 1')` for `relationship`,
`boundary` and `scene`. Those kinds are produced by `searchComposition`
(`src/lib/composition/search.ts:81-86,118-127`), accepted by `parseCompositionState`
(`src/lib/composition/parse.ts:212-235`), encoded by the permalink codec
(`src/lib/composition/codec.ts:79-94`) and selected by the studio canvas
(`CompositionCanvas.svelte:608-630` emits `{kind:'relationship', …}`).

**Rule violated**: plan, _CLI, HTTP and portable parity_ ("Inspect qualified node/claim" through
the shared boundary) and the completion checklist "CLI, HTTP, permalink and portable reader agree
on projection and diagnostics"; also CLAUDE.md §2 parity. Also note the stale error text ("phase 1")
now that phases 2-4 have shipped.

**Reproduction**:

```
searchComposition(...,'reads') → { kind:'relationship', model:'host', relationship:'call', … }
inspectQualified(composed, snapshots, thatSelection)
  → Error: Selection kind relationship is not supported in phase 1
```

i.e. `bin/fractal inspect --model host --composition plugins --selection
'{"kind":"relationship","model":"host","relationship":"call"}'` fails on a selection the studio
selects, the search returns and a permalink can carry. (`tests/composition-compose.test.ts:434`
pins the refusal as intended behaviour, so this is a deliberate but now-inconsistent boundary.)

**Suggested fix**: implement `relationship`, `boundary` and `scene` in `inspectQualified` over the
participating snapshot (the single-model inspector already has the data the studio uses), or — if
they are genuinely out of scope — reject them in `parseCompositionState`/`searchComposition` so no
surface can produce a selection the boundary refuses. Either way, add a search → inspect
round-trip test over every kind `searchComposition` can emit.

---

## Finding 7 — A collapsed frame's fixed height ignores its own measured title band

**Where**: `src/lib/composition/place.ts:41-58` — a collapsed frame is always
`COMPOSITION_METRICS.summary.height` (88) while `titleHeight` is measured from the wrapped title
(`lines * 20 + 32`). `src/lib/composition/svg.ts:184-190` then draws the divider at
`frame.y + titleHeight` and the "Collapsed summary" caption at `+30` beyond that.

**Rule violated**: plan, _Boundary and connection presentation_: "A subtle perimeter and a title on
the canvas identify each project; use current theme tokens, **generous measured title clearance**".

**Reproduction**: a project whose companion title wraps to four lines at the 260px summary width:

```
titleLines  ['Beacon plugin for extended','downstream telemetry','aggregation and reporting','services group']
titleHeight 112   frame { x:793.26, y:0, width:260, height:88 }
```

The title band (112) is 24px taller than the card that is supposed to contain it, so the divider
line and the summary caption are drawn outside the perimeter, and `composed.width/height`
(and therefore camera fit and the exported viewBox) understate the drawn artwork. The port-slot
maths (`compose.ts:128-146`) would also produce negative spans on such a frame.

**Suggested fix**: `height = max(summary.height, titleHeight + summaryBodyHeight)` for collapsed
frames, and assert `titleHeight <= frame.height` for every placed frame in the placement test.

---

## Smaller observations (no reproduction needed)

- **Admission counts omit bridges, ports and stubs.** `admissionCounts`
  (`src/lib/server/composition.ts:603-637`) counts only local diagram nodes/edges toward
  `visibleNodes`/`visibleEdges`. Bridge geometry reaches `cacheBytes` but never the visible-edge
  gate, so 999 local edges + 500 bridges is admitted under a 1,000 visible-edge limit. The plan
  asks to "Include bridge geometry … in resource accounting"; the guide documents the narrower
  behaviour, so this is a knowing gap worth either closing or restating in the plan.
- **A core rule is duplicated in the view layer.** `InspectorPanel.svelte:113-126`
  (`endpointHidesProposed`) re-walks proposed ancestors to decide which project's switch hides a
  claim, a rule `compose` already decided and published as `HiddenClaim.reason`. Two copies of one
  projection rule will drift; prefer deriving the reveal target from the composed `hidden` entry
  (extend it with the project whose switch hides it if the reason alone is not enough).
- **CLI `--selection` is not validated** (`scripts/fractal.ts:327`: `JSON.parse(...) as
QualifiedSelection`). A malformed selection surfaces as an internal error rather than a contract
  diagnostic; the state parser's `selection()` is right there.

## Plan bookkeeping (item 6 of the review brief)

`docs/plans/implemented/linked-project-diagrams.md` is materially stale and is the _controlling_
document for this work:

- header still reads "Status: phase 1 complete, 2026-09-13 … phase 2 starts next", although phases
  2-4 have shipped (studio, limits/queue/culling, SVG/PNG and portable HTML exports all exist and
  are tested);
- slices 2, 3, 4 and 5 carry no "— complete" marker and no evidence links, while 0 and 1 do;
- there are no phase-2/3/4 evidence records under `docs/plans/implemented/linked-project-diagrams/`
  (only `phase-0.md` and `phase-1.md`), breaking the plan's own one-record-per-slice convention and
  its "Evidence and phase N handoff" pattern;
- the completion checklist is entirely unchecked, including "Source-owned guides/models updated,
  independent reviewer recorded, installed studio verified" — the item this review feeds.

The guides were aligned separately (`43d2a0c`, `e03081e`, td-2668a7) but the plan was not touched.

## What held up

- **Identity.** Qualified everywhere a claim crosses a boundary: `{model, element}` refs,
  `{ownerModel, connectionId}` bridge identity, `qualifiedKey` JSON tuples, per-project port/stub
  owners, `underlying` provenance, per-project namespaced SVG/DOM title ids, `data-project` +
  `data-local-id` selectors. Nothing equates a local element with a foreign one by title or path
  (the one exception is Finding 3, which is catalog-mode, not core). Explicit-UID enforcement reads
  the adapter's `IdentityOrigins` (`likec4.ts:126,155`, metadata presence, never spelling) in both
  `compose.validateLinks` and `server/composition.localDiagnostics`, and the fixtures pin an
  explicit uid equal to its source id against a fallback id equal to its source id.
- **Projection.** Only scope exclusion yields ports; proposal exclusion hides with the owner switch
  _and_ both endpoints' visibility (except Finding 5's stub case); collapse resolves to the visible
  ancestor and a collapsed project to its summary; bundling keys on the representative pair plus
  kind/status/title/description and direction, keeping every owner in `underlying`; reverse and
  repeated claims keep both owners; cycles and diamonds reuse one frame per model; unopened links
  are stubs, never fabricated nodes; a failed target is diagnosed, stubbed and never blocks the
  root.
- **Boundary semantics.** Frames are pure presentation — no synthetic parent appears in any model,
  projection or export; trust memberships are read from each project's own model
  (`CompositionCanvas.boundariesFor`, `svg.nodeSvg`). Local geometry inside a frame is byte-identical
  to `layout()` standalone, verified here on the **real** sidecar/td/recall models as well as the
  fixtures.
- **Layout.** Placement is deterministic and camera-free (`compose` twice is `deepEqual`, verified
  on three frames and both engines); ports sit on perimeters below the title band with even slots
  and measured labels; the down engine stacks frames left-aligned.
- **System boundaries.** Resolution is catalog-only (routes take model ids, never directories or
  URLs); `linksFor` checks availability from entry metadata without compiling a foreign model;
  `/api/models` reads companion metadata only; admission limits come solely from `CatalogOptions`
  or `FRACTAL_COMPOSITION_LIMITS` (no route passes a body field); generations are client-owned and
  echoed; `revision_changed` (409) and `source_changing` (409, one retry) are honest; composed SVG
  is culling-independent, namespaced and escaped; the portable document advertises
  `linkedContract: 1`, embeds full snapshots plus a revision manifest, lists excluded links, and
  performs no fetch.

## Recommendation

Leave `td-430710` in review. Fix Findings 1-5 (1 is the blocker), decide on 6 and 7, then refresh
the plan's status, slice markers, phase evidence records and completion checklist before claiming
the linked-diagram work complete.

---

# Re-review — 2026-09-14, main at `9b5b7c2`

Same reviewer session (`ses_2aebc5`, context `reviewer-td-430710`), read-only. Reproductions were
re-run as `tests/scratch-*.test.ts` over the fixtures **and** over the real `sidecar` / `td` /
`recall` model directories through a temporary catalog in the session scratchpad; all scratch files
were deleted afterwards. `git status` shows only the coordinator's untracked
`docs/plans/implemented/linked-project-diagrams/phase-5.md` (the drafted phase 5 record — not mine).
`npm run check` → 744 files, 0 errors, 0 warnings. The repository's own composition suites are green:
`composition-{rules,compose,route,limits,export,cli,server,export-route,search,revision,process,codec,contracts}`,
`loader-snapshots`, `models-root`, `portable-linked` → 106 + 63 = 169 tests, 0 failures.

## Re-review verdict: **Obvious fix** — one remaining routing defect

Findings 2-7 and all three smaller observations are genuinely fixed, and the plan now carries phase
2, 3 and 4 records. Finding 1 is fixed for the case it was reported in (frames in a row, including
the real three-project `plugins` composition) but a second, adjacent case in the same function still
violates the invariant: the down engine with a narrow (collapsed) frame beside wide ones.

### Remaining finding RR-1 — the horizontal/vertical branch is chosen from frame centres, so a stacked pair with very different widths routes through both title bands

**Where**: `src/lib/composition/route.ts:124-126` (`horizontal` is decided by comparing
`|Δ frame-centre x|` with `|Δ frame-centre y|`) together with `:135` (`corridorX` of two frames that
overlap in x) and `:136-137` (a `project` representative anchors at the frame-edge **mid-height**,
which for a collapsed card lies inside its own title band).

**Rule violated**: the plan's "avoid node cards, project headers and unrelated frames" and phase 1's
recorded invariant "Bridges never cross a title band" — which the repository asserts for _every_
project, endpoints included, in `tests/composition-rules.test.ts:715` and
`tests/composition-compose.test.ts:493`.

**Reproduction A (real models)** — temporary catalog over sidecar/td/recall,
`layout --composition`-equivalent state with `layout: 'elk-layered-down'` and the root collapsed:

```
frames  sidecar {x:0, y:0,    w:260,     h:88}    titleH 52   (collapsed)
        td      {x:0, y:160,  w:3861.23, h:2571}  titleH 52
        recall  {x:0, y:2803, w:748.71,  h:865}   titleH 52
bridge  sidecar/td-integration
        [{260,44} → {130,44} → {130,1278} → {1959.86,1278}]   label {130, 661}
✖ real/elk-layered-down/collapsed=sidecar sidecar/td-integration
  segment 1 crosses the sidecar title band
```

Centre-to-centre Δx (1800.6) exceeds Δy (1401.5) although the frames are stacked, so the horizontal
branch is taken; `corridorX` of two frames that both start at x = 0 is 130, i.e. _inside both
frames_. The bridge leaves the collapsed card's right edge at y = 44 (inside its 0-52 title band),
doubles back left through the card's own title, then runs down x = 130 straight through td's title
band (y 160-212) before reaching the node. The label is drawn at (130, 661), deep inside the td
frame over its content.

**Reproduction B (deterministic unit case, no catalog)** — `routeBridge` with the same rectangles:

```
source frame {0,0,260,88} (project representative), target node {1679.86,826,280,92} in
frame {0,160,3861.23,2571}, otherFrames [recall]
points [{260,44},{130,44},{130,1104},{1699.86,1104}]  label {130,574}
crosses the source title band: 2 segments | label inside the target frame: true
```

The obstruction-aware escape never engages because the obstruction is the _endpoint_ frames
themselves, not a third frame. It is not limited to collapsed frames: any stacked pair whose width
difference exceeds their vertical separation takes the same branch.

**Suggested fix**: decide the axis from the frames' actual separation rather than their centres —
if the two frames overlap in x (or their x-gap is smaller than their y-gap), route vertically; and
when a `project` representative's frame-edge anchor would fall inside that frame's title band, anchor
below the band (the port slots already do this at `compose.ts:135-140`). Then widen the routing test
matrix to the down engine with mixed frame widths — one narrow/collapsed frame beside a wide one —
asserting no segment crosses _any_ project's title band and the label is outside every frame.

### Verified fixed

| #   | Original finding                                          | Re-verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bridges cross unrelated frames/cards/title bands          | **Row engine fixed.** The real `plugins` composition and all collapse combinations in `elk-layered`, plus the three-fixture matrix in both engines: no segment crosses a non-endpoint frame, no label sits inside one, every segment is axis-aligned, `source.point`/`target.point` are identical to the first/last path points, and every endpoint anchors on its node card, frame perimeter or port. `compose` twice is still `deepEqual`. The post-shift double-move is gone: with an above-lane escape the port point stays exactly on the perimeter and the bridge's last segment stays axis-aligned. Geometry no longer has negative y and stays inside the reported `width`/`height`. Remaining gap: RR-1 above. |
| 2   | Linked HTML export bypassed admission limits              | Fixed. `exportLinkedDocument` now runs `checkAdmission(snapshotAdmissionCounts(...))` against caller-supplied limits and throws `BudgetExceededError` before allocating the document; the CLI and `/api/export` pass `effectiveLimits({})`, and the route maps it to 422. With `FRACTAL_COMPOSITION_LIMITS={"loadedElements":5}` over the real catalog both SVG and linked HTML are refused with the same diagnostics. The adapter stays below the server boundary (limits are injected, never read there).                                                                                                                                                                                                             |
| 3   | Identity by directory name                                | Fixed. `validateEntry` compares the companion id in **every** catalog kind, and both `catalogResolver` and `catalogReloader` re-check `snapshot.id === requested`. The `mdir` repro (a directory named `plugin` holding the Relay model) now gives `links` status `invalid`, `validate --linked` invalid with `model_invalid` naming the mismatch, no `plugin` frame, a `model_invalid` diagnostic, an `invalid` stub, and **zero** bridges — no claim binds to a foreign component.                                                                                                                                                                                                                                    |
| 4   | A target's stale view destroyed the composition           | Fixed. `sanitizeView` drops unknown `expanded` ids and an unknown or proposal-hidden `scope`, emitting `endpoint_missing`/`repair` with the exact `composition.projects[i].view.*` path. Verified for stale `expanded` and `scope` on a **target** and on the **root** (the recorded decision): both keep all projects and diagnose; the returned `state` still carries the author's intent unchanged, so only the layout input is sanitized.                                                                                                                                                                                                                                                                           |
| 5   | Stub for a proposal-hidden local endpoint                 | Fixed. The unopened-target loop now checks `endpointProposedHidden` for the local endpoint: the `third`/`beta` current-claim case produces no stub and a `hidden` entry with `reason: 'proposed-endpoint'` and `endpoint: {model:'third', element:'beta'}` — the same as when the target is open.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Selections search/state/codec produce but inspect refused | Fixed. `inspectQualified` implements `relationship`, `boundary` and `scene` (with named endpoints/members). Every non-`link` selection `searchComposition` emits across five queries round-trips through `inspectQualified`; all four kinds observed. The "phase 1" error text is gone.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Collapsed frame ignored its title band                    | Fixed. `summaryBodyHeight` grows the card: the four-line title case now gives `titleHeight` 112 ≤ frame height 148, and `portPoint` clamps the span to ≥ 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| a   | Admission counts omitted bridges/ports/stubs              | Fixed. `visibleAdmissionCounts` adds bridges to `visibleEdges` and ports + stubs to `visibleNodes`; measured exactly (`visibleNodes` 7 = 5 local + 1 port + 1 stub, `visibleEdges` 6 = 2 local + 4 bridges). Shared by the server boundary and the HTML export.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| b   | Proposed rule duplicated in the view layer                | Fixed. `endpointHidesProposed` is deleted; `showProposedTarget` reads `HiddenClaim.endpoint` from the composed result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| c   | CLI `--selection` was cast, not parsed                    | Fixed. The CLI wraps `JSON.parse` failures in `CompositionContractError`, and `inspectInComposition` re-parses the selection through the state parser: a missing element, an unknown kind, a non-participating owner, an array and a bare string all come back as `CompositionContractError` with `composition.selection…` paths; a valid selection still inspects.                                                                                                                                                                                                                                                                                                                                                     |
| —   | Composed PNG                                              | Full-page verified end to end: a 1695.69 × 867 composed SVG renders a 3392 × 1734 PNG (ceil × deviceScaleFactor 2) — the artwork fills the raster at its own aspect instead of a letterboxed 1920 × 1080 viewport.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| —   | Composed SVG page framing                                 | Verified in `grove`, `graphite` and `midnight`: `data-theme` applied, title/subtitle/footer layers present, and the diagram layer's translate keeps every bridge point and frame inside the page in both axes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| —   | Plan bookkeeping                                          | `phase-2.md`, `phase-3.md` (+ baselines), `phase-4.md` now exist and slices 2-4 carry "— complete" with evidence links. `phase-5.md` is drafted but untracked, as stated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Remaining bookkeeping (not blocking, fix while finalizing phase 5)

- `docs/plans/implemented/linked-project-diagrams.md:3-7` still reads "Status: phase 1 complete,
  2026-09-13 … phase 2 starts next", which the phase 2-4 records it now links contradict.
- The completion checklist is still entirely unchecked, including "independent reviewer recorded".

### Smaller observations (no action required)

- `compose`'s post-route shift corrects negative **y** only. A left escape lane can reach
  `x = -gap/2` (-36 was observed on the fixture down-engine case), which `composed.width` does not
  include. The export compensates through its own `minX`, and `CompositionCanvas.fit()`'s 96px
  margin absorbs it, so nothing is clipped today — but a consumer that trusts `width`/`height` as
  the artwork box is 36px short on the left.
- When **both** endpoints of a claim are proposal-hidden, `HiddenClaim.endpoint` names the source
  only (documented check order), so the inspector offers one switch and the claim stays hidden until
  the other project's switch is flipped too.

---

# Final confirmation — 2026-09-14, main at `7070763`

Same reviewer session (`ses_2aebc5`, context `reviewer-td-430710`), read-only. Only the RR-1
reproduction was re-run, plus the affected repository suites. Scratch files deleted; the working
tree carries only the coordinator's in-flight docs (`M linked-project-diagrams.md`,
`M phase-3.md`, `?? phase-5.md`). `npm run check` → 744 files, 0 errors, 0 warnings.
`composition-{route,compose,rules,export,limits}` → 86 tests, 0 failures.

## Final verdict: **Clean**

### RR-1 is fixed

`routeAxis` (`route.ts:56-69`) now derives the axis from actual frame overlap — x-overlap routes
vertically, y-overlap horizontally, neither takes the larger clear gap — and `projectAnchor`
(`route.ts:72-90`) anchors a project representative below its own title band on the facing side, the
same rule the port slots use. `portSide` shares `routeAxis`, and the post-route shift normalises x
as well as y.

**Reproduction A (real models, `elk-layered-down`, root collapsed)** — the bridge that previously
struck through two title bands:

```
frames  sidecar {0,0,260,88} titleH 52 (collapsed)   td {0,160,3861.23,2571}   recall {0,2803,748.71,865}
before  sidecar/td-integration [{260,44},{130,44},{130,1278},{1959.86,1278}]  label {130,661}
after   sidecar/td-integration [{130,88},{3897.23,88},{3897.23,1190},{2065.86,1190}]  label {3897.23,124}
```

It now leaves the collapsed card on its **bottom** edge at y = 88 — below the 0-52 title band —
escapes right to x = 3897.23, clear of every frame, drops to the node's row and enters td's
`monitor` card on its facing (right) edge. The label sits in the open lane outside all frames.

The whole matrix was re-checked: both engines × seven collapse combinations (none, each single
project, two pairs, all three) plus the authored `plugins` composition. For every bridge: no segment
crosses **any** project's title band or any non-endpoint frame; no label sits in a title band or an
unrelated frame; every segment is axis-aligned; `source.point`/`target.point` are identical to the
first/last path points; every endpoint sits on its representative's edge **and** on the side facing
the next path point; project anchors are never inside their own title band; no geometry has negative
x or y, and everything stays within the reported `width`/`height`. The authored composition still
reports no diagnostics.

**Reproduction B (deterministic `routeBridge` unit case, same rectangles)**:

```
points [{130,88},{3897.23,88},{3897.23,1058},{1839.86,1058}]  label {3897.23,124}
```

Zero crossings of the three title bands and of the unrelated recall frame, label outside all of
them, all segments axis-aligned, source anchored below its band, target entering the node on its
near (top… here facing/right) edge.

### Plan bookkeeping confirmed

The header now reads "Status: phases 0–4 complete, phase 5 finishing, 2026-09-14" with per-phase td
ids, each slice links its evidence record, and the completion checklist has the first six items
ticked; the last two (artwork review, and reviewer recorded + installed studio verified) remain open
as expected — they close after this verdict and the installed-studio run.

### Closed observations

The earlier negative-x observation is resolved: the post-route shift normalises x, and the matrix
asserts `min x ≥ 0` and `min y ≥ 0` against the reported bounds. The only remaining note is
cosmetic and by design: when both endpoints of a claim are proposal-hidden, `HiddenClaim.endpoint`
names the source (documented check order), so the inspector offers one switch at a time; and two
claims leaving one collapsed frame share the same anchor point and lane, which is inherent to a
collapsed project having a single stand-in.

**td-430710 approved.**
