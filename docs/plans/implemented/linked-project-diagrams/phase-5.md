# Linked diagrams: phase 5 evidence

Status: complete, 2026-09-14. Epic: `td-7ecb7a`. Tasks: Recall model `td-8197f9`, Sidecar
links and Recall element `td-c4c760`, documentation `td-2668a7`, final independent review
`td-430710`, review fix batches `td-efd8d3` and `td-4c4f73`. The
[controlling plan](../linked-project-diagrams.md) defines completion.

## Source-owned models

- **Recall** now owns `docs/diagrams/fractal/` (commit `a427795` in the recall repository):
  21 elements and 27 relationships with explicit uids, four scenes, three boundaries, evidence
  paths verified, and a `sidecarplugin` element for `internal/cli/sidecarplugin.go`
  (`sidecar.plugin/v1`). Registered in the local catalog.
- **Sidecar** authors the linked claims (commit `6994d1b3` in the sidecar repository): a new
  `plugins.external` element for the generic external plugin host with real evidence, and
  `links.json` with `td-diagram` / `td-integration` (`plugins.td` → `td/monitor`, `embeds`) and
  `recall-diagram` / `recall-integration` (`plugins.external` → `recall/sidecarplugin`,
  `spawns`), plus the `plugins` composition. td's `monitor` endpoint carries an explicit uid; td
  needed no change.
- The fictional third plugin lives only in `tests/fixtures/linked-projects/third/`.

## Real steel thread

On the live catalog: `fractal links --model sidecar` resolves td and recall; `validate --linked`
is valid with no diagnostics; `layout --composition plugins` composes Sidecar, td and Recall with
two bridges (`plugins` → `monitor`, `plugins` → `recall`), no stubs and no hidden claims; SVG,
PNG and `--include td,recall` HTML exports carry revision manifests. After the final-review
routing fix the Sidecar → Recall bridge escapes above the td frame instead of crossing it.

## Documentation

Guides for catalog, usage, contract, model format, portable HTML and the CLI reference, the
Fractal skill, `DESIGN.md`, `README.md` and the product plan were aligned with shipped behavior
and reviewed sentence by sentence against the code (seven accuracy findings fixed).

## Final independent review

Claude Opus 5 reviewed identity, projection, boundary semantics, layout and system boundaries
read-only over main (`td-430710`, report recorded in td). Verdict at review time: Bigger issue,
with one blocker (bridges between non-adjacent frames crossed the frame between them) and six
further findings; identity, projection rules, boundary semantics, deterministic layout,
catalog-only resolution, honest revisions, exports and the portable reader were verified sound.
Every finding was fixed and independently re-verified (`td-efd8d3`, `td-4c4f73`, `td-07dfd9`);
the re-review found one remaining routing case (stacked frames of different widths in the
top-to-bottom engine), fixed and re-verified in `td-4f6a50`, after which the reviewer's final
confirmation is recorded on `td-430710`.

## Installed studio

`bin/fractal service install` from main `7070763` (release `2026-09-14T14-28-21Z`, tailnet
exposure preserved). A headless journey against the installed service with the live catalog
opened Sidecar, revealed td from the TD Task Monitor inspector, expanded Monitor TUI, inspected
the bridge, collapsed and closed td: only root requests before open, exactly the td model and one
composition render on open, two frames and one bridge, no duplicate DOM ids, the Sidecar title at
the same screen position and scale throughout, no page errors. The busy badge now appears
100.8 ms after a slow reveal (gate 150 ms), closing the last phase 3 gate. A phone-width run
(390 × 844, touch) renders the composition with the mobile chrome intact.
