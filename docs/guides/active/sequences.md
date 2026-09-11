# Explorable sequence journeys

Sequence views are a sibling of architecture views. They explain an authored scenario over time,
with stable identities for participants, messages and nested presentation phases. The current
profile is experimental; it is not a public interoperability standard or a full UML implementation.

## Repository-owned input

Add `sequences.json` next to `model.c4` and `fractal.json` in `docs/diagrams/fractal/`. It is optional;
existing two-file models need no changes. Fractal reads all three files together for revision
identity. A sequence edit appears after **Reload sequence** without reinstalling the application.

```json
{
  "version": 1,
  "journeys": [
    {
      "id": "request",
      "title": "A request becomes a result",
      "description": "An authored successful request path.",
      "provenance": "Authored from the project's API contract; not a captured trace.",
      "status": "current",
      "participants": [
        { "id": "caller", "title": "Caller" },
        { "id": "api-lane", "element": "api", "title": "API" },
        { "id": "worker-lane", "element": "worker", "title": "Worker" }
      ],
      "groups": [
        { "id": "service", "title": "Service", "participants": ["api-lane", "worker-lane"] }
      ],
      "steps": [
        {
          "type": "phase",
          "id": "processing",
          "title": "Process the request",
          "steps": [
            {
              "type": "message",
              "id": "submit",
              "from": "caller",
              "to": "api-lane",
              "title": "Submit request",
              "kind": "call"
            },
            {
              "type": "message",
              "id": "dispatch",
              "from": "api-lane",
              "to": "worker-lane",
              "title": "Dispatch accepted work",
              "kind": "async"
            },
            {
              "type": "message",
              "id": "result",
              "from": "worker-lane",
              "to": "api-lane",
              "title": "Return result",
              "kind": "return"
            }
          ]
        }
      ]
    }
  ]
}
```

The example assumes existing architecture elements `api` and `worker`; substitute your model's
normalized stable IDs. If an architecture element is proposed, a journey referencing it must be
proposed too. Unlinked participants, such as an external caller, require a title. Linked participants
inherit their architecture title, description and color unless overridden. Optional descriptions
default to empty text, message kind to `call`, and journey status to `current`.

Use explicit stable IDs. Keep participant, group, phase and message identities distinct within a
journey, and do not use the reserved `summary:` prefix. Message endpoints reference participant
IDs; `element` references architecture IDs.
Groups contain disjoint, contiguous runs of participants in their authored order. This prevents a
collapse from silently reordering other columns. Phases can nest. Unknown fields and unsupported
step types are refused, including control-flow constructs the viewer cannot faithfully represent.

## What folding means

Array order is the authored scenario order. Vertical space is for readability, not elapsed time.
`call`, `return`, and `async` distinguish message intent; the diagram does not infer call stacks,
activation lifetimes, retries, concurrency, or runtime timing from them.

A phase is a presentation group. Collapsing it produces a named summary containing its original
message IDs, not a fabricated endpoint-to-endpoint arrow. Collapsing a participant group preserves
external messages in order and summarizes only consecutive internal activity. Hiding a participant
retains explicitly omitted interactions; it never reconnects the remaining endpoints. At least one
participant must stay visible. These rules apply identically to the viewer, CLI and SVG export.

Use separate journeys for different scenarios for now. Alternatives, loops, parallel branches,
activation bars, timing and trace import need their own semantics and are not represented by phases.
Do not relabel a phase “parallel” and claim concurrency is modeled.

## Agent and API surfaces

```sh
FRACTAL_ROOT=/absolute/path/to/fractal
MODEL_DIR=/absolute/path/to/project/docs/diagrams/fractal

"$FRACTAL_ROOT/bin/fractal" validate --directory "$MODEL_DIR" --json
"$FRACTAL_ROOT/bin/fractal" journeys --directory "$MODEL_DIR" --json
"$FRACTAL_ROOT/bin/fractal" journey --directory "$MODEL_DIR" --journey request --json
"$FRACTAL_ROOT/bin/fractal" sequence --directory "$MODEL_DIR" --journey request \
  --collapsed-groups service --collapsed-phases processing --json
"$FRACTAL_ROOT/bin/fractal" sequence --directory "$MODEL_DIR" --journey request \
  --hidden-participants caller --scope-phase processing --json
"$FRACTAL_ROOT/bin/fractal" sequence-export --directory "$MODEL_DIR" --journey request \
  --theme midnight --format svg --output /absolute/path/to/request.svg
"$FRACTAL_ROOT/bin/fractal" sequence-export --directory "$MODEL_DIR" --journey request \
  --collapsed-phases processing --format png --output /absolute/path/to/request.png
```

The CLI defaults to full detail. Explicit options reproduce any browser projection. `journey`
returns the normalized authored record; `sequence` returns columns, rows, geometry, effective view
state and exact message provenance. SVG metadata retains identities, and summaries remain visibly
labeled in both SVG and PNG. Inspect actual exports; use phase focus or folding when a long journey
would make a single slide too dense.

`GET /api/models/:id` includes `sequences` and `revision`. `POST /api/sequence` accepts
`{model, journey, revision, state}` and returns the same geometry. `/api/sequence/export` accepts the
same input and returns SVG. A supplied stale revision is refused by both endpoints. View state is:

```json
{
  "collapsedPhases": [],
  "collapsedGroups": [],
  "hiddenParticipants": [],
  "theme": "grove"
}
```

Add `visiblePhases` with exact phase IDs to select some phases; `[]` shows none, and omitting it
shows the full journey including messages outside phases. Only selected phases contribute direct
messages. Ancestor headings remain marked as context and cannot fold away selected descendants.
`scopePhase` remains supported for older single-phase links; it cannot be combined with `visiblePhases`.
Use `--visible-phases prepare,publish` for the same selection in `sequence` and `sequence-export`;
pass an empty string to show none. Export footers report included versus total interactions.
Do not store geometry as model truth.

## Open and explore

The architecture sidebar lists available sequences; Cmd/Ctrl+K can find them too. Open a direct
link such as `http://127.0.0.1:5199/sequence?model=delivery&journey=draft-review`. Sequence links
include their JSON view state in the URL's `seq` parameter, so folds, phase visibility, hidden participants, scope and
theme are restorable. The sequence studio is the same studio: one sidebar component, appbar,
toolbar, inspector, modals, theme family, presentation mode and keyboard registry, with an appbar
switcher between Architecture and Sequences. The sidebar's middle section lists phases and
participants where architecture lists its outline. Native buttons remain
keyboard accessible. Use the shortcut sheet for the current bindings, or `bin/fractal shortcuts --surface sequence --json`.

Participant links return to the associated architecture component. The journey's provenance and
inspector explain what its messages claim; linked architecture components carry evidence pointers, not automatic
verification. Keep sequence updates with the project they describe.

## Hidden lanes and participant groups

Hiding a participant leaves a small count marker at its authored position among the headers.
The marker names the hidden lanes on hover or keyboard focus; click it, or focus it with horizontal
navigation and press Enter/Space, to restore them. Adjacent hidden lanes share a marker. If a lane
was inside a combined group, restoring it also separates that group so the lane becomes visible.
Exports retain the marker and the exact hidden identities. Folded phase summaries report how many
interactions involve hidden participants; these counts remain accurate when phases are folded.

A group's participant count describes its membership. **Combine lanes** renders those participants
in one chart column; **Separate lanes** restores their individual columns. Their visibility
controls stay available under the group in either mode.

## Phase visibility

Click a phase name to show or hide it. **Only** isolates that phase and its descendants; **Show all**
restores the complete journey. A parent action includes its subtree. A minus indicates a partial
subtree; clicking it shows the whole subtree. Hidden phases keep an eye-off icon and struck name.
The caret separately folds interaction detail, and Show all preserves those folding preferences.
When only a child is selected, its parent heading provides context without contributing messages.
All controls support keyboard focus and activation; Only remains visible on touch devices.
