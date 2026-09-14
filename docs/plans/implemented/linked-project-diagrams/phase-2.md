# Linked diagrams: phase 2 evidence

Status: complete, 2026-09-14. Epic: `td-9e7271`. Tasks: core projection rules `td-6dce74`,
state codec, search and revision contract `td-deddd1`, server/CLI/HTTP `td-87355e`, studio
`td-bd6844`. The [controlling plan](../linked-project-diagrams.md) defines acceptance.

## What shipped

- **Projection rules.** Only scope exclusion yields perimeter ports (with counts and reveal
  targets); proposal exclusion hides a claim and records it in `hidden` with the owner or
  endpoint reason; collapse resolves to the visible ancestor; identical claims bundle with a
  count and qualified `underlying` provenance; reverse and repeated claims keep both owners;
  cycles and diamonds reuse one frame per model. A fictional third plugin fixture with colliding
  IDs exercises the cycle, the diamond and a proposed claim.
- **State, search, revision, limits.** A versioned, bounded URL codec for composition state;
  qualified search across participating models with unopened links as metadata results; revision
  vectors, generations and the `revision_changed` / `source_changing` diagnostics; admission
  limits and byte estimates.
- **Server, CLI and HTTP.** Revision conflict with stamp-verified reload and one retry; catalog
  isolation (duplicate IDs fatal, a malformed unrelated model never blocks a healthy composition);
  symmetric linked validation (`td-f4266c`); encoded state accepted by CLI and HTTP; a search
  route; admission limits enforced at the boundary; a live-server 409 → reload proof.
- **Studio.** Permalinks in the `composition` URL parameter; per-project scene selection, focus
  and scope from the title-band menu; ports with reveal; aggregated bridges and hidden-claim
  explanations in the inspector; a revision banner with explicit reload; project-qualified jump
  search that reveals unmounted nodes; keyboard spatial navigation across frames; a three-frame
  browser journey. Render generations are client-owned: the server scopes stale answers by an
  optional per-tab client id and never answers stale without one.

## Evidence

| Outcome                                                                                          | Evidence                                                                |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Ports, proposal rules, bundling, cycle/diamond, reverse claims                                   | `tests/composition-rules.test.ts`, `tests/composition-compose.test.ts`  |
| Codec bounds and round-trips, search, revision, limits                                           | `tests/composition-codec.test.ts`, `-search`, `-revision`               |
| Revision conflict, isolation, symmetric validation, limits                                       | `tests/composition-server.test.ts`, `tests/composition-process.test.ts` |
| CLI parity for encoded state and search                                                          | `tests/composition-cli.test.ts`                                         |
| Studio journeys (two-frame, proposed-endpoint switch, three-frame permalink/ports/search/reload) | `tests/browser.spec.ts` linked specs                                    |

Each workstream was reviewed by an independent session that reproduced its findings; every first
review found at least one real defect (encode-time cap, proposed claims to unopened targets,
mutual exclusion of selectors, the Show-proposed target, and the cross-client stale generation
found by the orchestrator's merged-branch gate run), and every re-review was Clean. Broad gates on
each merged candidate: `npm run check` clean, `npm test` green, `npm run build` green.
