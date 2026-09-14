# Linked diagrams: phase 1 evidence

Status: complete, 2026-09-13. Epic: `td-e673b8`. Tasks: loader `td-4bfcce`, composition core
`td-069a7d`, CLI and HTTP `td-21d4f9`, studio `td-e9b31f`, proof `td-a2348b`.
The [controlling plan](../linked-project-diagrams.md) defines acceptance; this document records
what shipped, the evidence, and the handoff to phase 2. It does not authorize later phases.

## What shipped

- **Loader.** `parseModelWithOrigins` records whether every element and relationship ID was
  authored (`uid`) or generated. `links.json` is parsed into the model snapshot, stamped and
  hashed into the revision. Catalog parsing is split from targeted entry validation:
  `resolveProject` validates one entry, `validateCatalog` reports every failure, `listProjects`
  reads companion metadata only and carries per-entry diagnostics, and `catalogResolver` is the
  catalog-backed `SnapshotResolver`. The server-start warm-up that compiled the whole catalog is
  gone.
- **Composition core** (`src/lib/composition/`). `compose(resolver, state)` resolves at most two
  projects at a time, validates links against explicit identity, lays each open project out with
  the unchanged `layout()`, places frames deterministically, routes bridges through the corridor
  between frames from the visible representative of each endpoint, emits reference stubs for
  unopened or failed targets, and returns typed diagnostics. State helpers derive
  `CompositionState` from scenes and authored compositions. Qualified inspection is shared.
- **CLI and HTTP.** `fractal links`, `fractal validate --linked` (visited-set closure, 20-model
  traversal budget, nonzero on unresolved claims), and `--composition` / `--composition-state` on
  `project`, `layout`, `inspect` and `search`; `/api/composition/{links,validate,render}` with
  400 / 409 `revision_changed` / 422 `budget_exceeded` mapping and recoverable diagnostics at 200. One application boundary, `src/lib/server/composition.ts`, serves both.
- **Studio.** A "Linked diagrams" inspector section with per-link resolution status; opening a
  link renders two titled project frames and the authored bridge on the one camera, preserving
  the source title's screen position and scale; expansion inside the target, bridge inspection
  leading with the readable route and exact endpoints, a title-band project menu (collapse,
  reopen, close, open standalone), repeated activation reveals the existing frame, unavailable
  references render honest cards, SVG ids are namespaced per project, and the action is
  registered in `core/shortcuts.ts`.

## Evidence

| Outcome                                                 | Evidence                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Identity origins from the adapter                       | `tests/loader-snapshots.test.ts` against both `identity-origins.expected.json` fixtures                        |
| Targeted resolution; healthy entries survive a bad one  | `tests/catalog.test.ts`, `tests/loader-snapshots.test.ts` (four-entry temp catalog)                            |
| Local geometry unchanged inside a frame                 | `tests/composition-compose.test.ts`; `bench` fingerprints for Sidecar and td identical to the phase 0 baseline |
| Bridges never cross a title band; label in the corridor | `tests/composition-compose.test.ts` (both engines, open and collapsed)                                         |
| CLI and HTTP agree; single-model commands unchanged     | `tests/composition-cli.test.ts`, `tests/composition-server.test.ts`                                            |
| Studio journey on fictional fixtures                    | `tests/browser.spec.ts` "a linked project opens beside its host…"; full Playwright run green                   |
| Real Sidecar → td steel thread                          | Recorded in `td-a2348b`; local screenshots `artifacts/linked-project-phase1/steel-thread-*.png`                |

Real steel thread, on a temporary catalog holding copies of the Sidecar and td models plus a
`links.json` in the Sidecar copy (`plugins.td` → `td/monitor`, `embeds`, current; no sibling
repository changed): `links` resolves td, `validate --linked` is valid, `layout --composition
plugins` composes Sidecar (11 visible nodes) and td (9) with one bridge and no diagnostics, and
`inspect` returns the route, claim, exact endpoints and evidence. In headless Chromium the root
loads with only the catalog, model and render requests; opening the link adds exactly the td model
and one composition render; two frames and one bridge appear with no duplicate DOM ids; the Sidecar
title stays at the same screen position and scale through open, td expansion, collapse and close;
Fit brings both frames into view; the bridge inspector reads "Sidecar / TD Task Monitor → td /
Monitor TUI" with the drawn representative (Domain Plugins) reported separately, matching the CLI.

Broad gates on the merged candidate: `npm run check` clean, `npm test` green, `npm run build`
green, recorded per merge in `td-e673b8`.

## Phase 2 entry points

- `fractal links` and `/api/composition/links` report catalog availability from entry-level
  validation only; a malformed target is found by opening it or by `validate --linked`. Phase 2's
  failure-behavior work should keep that boundary: no foreign parse before an explicit reveal.
- `validateLinked` checks connection endpoints in traversal order; make it symmetric
  (`td-f4266c`).
- Permalinks, scene/scope changes, outside-scope ports, claim aggregation, proposed/current
  visibility rules and revision conflict/reload behavior remain phase 2. Culling, low-zoom detail
  and byte bounds remain phase 3. Exports remain phase 4.
- Source-owned model work (Sidecar's Recall element, a Recall model) is still a prerequisite for
  the complete steel thread and belongs in those repositories.

## How this phase was built

Five DeepSeek V4.1 Flash sessions on the OpenCode harness (via OpenCode Go), each in a Sidecar
worktree or shell, briefed by a file inside its worktree, tracked in td with its own
`TD_CONTEXT_ID`, and coordinated over comms (`fractal-linked-phase1`). Every implementation was
reviewed by a separate DeepSeek session that reproduced its findings before recording a verdict;
every first review returned "Obvious fix" with one to three real defects, every re-review was
Clean, and the orchestrator's real-catalog proof found two more (Fit and route parity) that the
fixture-only journey could not show.
Implementation sessions ran roughly eight to thirty minutes; reviews two to nine. The orchestrator
merged each reviewed branch to `main` after running the broad gates on the integrated candidate.
