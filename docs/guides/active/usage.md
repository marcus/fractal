# Working with linked diagrams

Several repository-owned models can share one studio canvas. Each project keeps its own
hierarchy, scenes, memberships and provenance; a quiet frame with a title band marks
where one project ends and the next begins. Frames are presentation geometry, never new
model structure. This guide covers the studio journey; the [model format
guide](model-format.md#linking-to-other-projects) covers authoring `links.json`, the
[catalog guide](catalog.md) covers registration and validation, and the [linked project
contract](linked-project-contract.md) is the frozen reference.

## Open a linked diagram

A linked target opens from its source element's inspector section or its outline action,
or with **Mod+Shift+L** anywhere in the studio. The target frame appears beside the
source at the current scale, with the source title unmoved and still visible. Opening
the same link again reveals the existing frame rather than adding another: one visible
instance per project.

A project that cannot resolve renders an honest card in place of a frame — unregistered,
invalid or incompatible — with the recovery step attached. It never invents a component.
A link whose target was never opened stays a labeled reference stub at the source;
connections into it remain authored claims, inspectable but not drawn as bridges.

## The project menu

Every title band carries a menu for its project:

- **Scene** — switch the project's saved perspective; scope, expansion and proposal
  visibility follow that scene.
- **Focus** — focus a component within the project, or clear the focus.
- **Collapse / Reopen** — fold the project to a titled summary that keeps its
  connection anchors; reopening restores its last view.
- **Fit project** — frame this project; **Fit** (or **0**) still frames everything.
- **Close** — remove the frame from the composition; the authored link stays available
  at the source. Closing the root returns to the ordinary single-project view.
- **Open standalone** — leave the composition for that project's own diagram.

Expanding or collapsing inside a frame follows the toggled title at the current scale,
as single-project expansion does. Nothing else moves and the camera never rescales on
its own.

## Ports and aggregated bridges

A bridge is drawn from the visible representative of each endpoint: the element itself
when visible, its collapsed ancestor when an ancestor is collapsed, the project summary
when the whole project is collapsed. An endpoint outside the project's selected scene
scope lands on a labeled perimeter port with an outside-scope count; activating the port
reveals the element. Ports are visually distinct from components, and only scope
exclusion produces them — proposal exclusion hides the claim instead.

Claims that share identical visible representatives, kind, status, title and description
bundle into one drawn bridge with a `×N` count. The bundle preserves every qualified
underlying claim (`{ownerModel, connectionId}`), and inspection exposes each one.
Unrelated claims never merge to reduce clutter.

## Inspect a bridge

Selecting a bridge leads with the readable route — project and component names at both
ends — then the claim description, the exact `{model, element}` endpoints with the drawn
representative reported separately, and the owning project's source evidence. A
collapsed or scoped-out endpoint is reported as such, with its reveal action. Proposed
bridges draw dashed in the theme edge color; current bridges draw solid. Color is never
the only signal: the inspector states the status in words.

## Permalinks and revision reload

**Copy view link** stores the composition state in the URL (`?composition=v1.…`)
alongside the usual view fields. A permalink reproduces view intent against current
sources; it is not a revision lock. When a participating source changes underneath, the
studio keeps the last coherent view and says so — it never silently mixes new model
content with old geometry. Reload explicitly (**Mod+Shift+R**, or **Model source →
Reload model**) to recompose against the new revisions. The same revision vector travels
through the CLI and HTTP surfaces, where a conflict is a structured `revision_changed`
answer with an explicit reload path.

## Search across projects

**Cmd/Ctrl+K** searches every participating model and returns project-qualified results
with the selection needed to jump to them; jumping reveals the required layers first.
Unopened link targets are searchable link metadata only — a labeled result with a reveal
hint, never searched model content. **Cmd/Ctrl+Shift+K** still switches projects.

## Export the composition

SVG and PNG exports render the exact requested composition, including offscreen content
and omission indicators, independent of what the viewport currently shows. A failed
participating target fails the export with diagnostics naming owner, target and
recovery; `--allow-unresolved` (CLI) renders unavailable cards instead and carries the
diagnostics in the manifest. Unopened links are intentional omissions listed in the
manifest, never errors. Every export returns a JSON manifest with the resolved state,
per-project revisions, omitted links and unresolved targets.

Portable HTML needs an explicit included set: `--include` names the linked projects to
embed with the root. A root owning `links.json` exported without `--include` is still a
linked document — its included set is the root only, and every authored link is reported
excluded. See the [portable HTML guide](portable-html.md#linked-projects).

## Next slice

Two studio refinements are in flight and not yet on this canvas: viewport culling with
an overscan margin plus reduced label detail at low zoom (semantic state is unaffected —
culled content stays inspectable and exported), and composition options in the Export
dialog (today the dialog covers the current single-project view; composed exports go
through the CLI or HTTP). They will be documented here when they land.
