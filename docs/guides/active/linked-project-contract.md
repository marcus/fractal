# Linked project contract, version 1

Status: phase 0 contract foundation. The shared library parses and tests these values, but the
studio, CLI, model loader and portable reader do **not** consume `links.json` or composition state
yet. This guide freezes the contract for the
[linked-project implementation plan](../../plans/active/linked-project-diagrams.md); it is not a
claim that linked rendering has shipped. Existing single-project commands remain unchanged.

A capable reader must explicitly advertise support for **linked-project contract v1**. There is
no released minimum application version yet. The application's current `0.0.1` version does not
establish support. Future artifacts/tooling must check capability and never report a complete
composition when only its root was rendered.

## Repository-owned links

An optional `links.json` sits beside `model.c4` and `fractal.json`. Missing files retain ordinary
single-project behavior. `parseLinks(input, ownerModel)` accepts decoded JSON and the authoring
model's catalog ID; it performs no I/O. This example is fictional:

```json
{
  "version": 1,
  "links": [
    {
      "id": "beacon-diagram",
      "from": "plugins.beacon",
      "target": { "model": "beacon", "scene": "overview" },
      "title": "Beacon architecture"
    }
  ],
  "connections": [
    {
      "id": "invoke-beacon",
      "source": { "model": "harbor", "element": "plugins.beacon" },
      "target": { "model": "beacon", "element": "cli" },
      "title": "Invokes plugin CLI",
      "kind": "uses",
      "status": "current",
      "description": "The local adapter calls the plugin's CLI.",
      "evidence": ["src/plugins/beacon.ts"]
    }
  ],
  "compositions": [
    {
      "id": "plugins",
      "title": "Harbor and its plugins",
      "rootScene": "overview",
      "projects": [{ "model": "beacon", "scene": "overview", "mode": "open" }]
    }
  ]
}
```

`version` and `links` are required. Omitted `connections` and `compositions` normalize to empty
arrays. Link `from` is optional for root-level navigation; target scene is optional. IDs and titles
are required. A link names a foreign project, never a directory or URL. Multiple links may point
to the same model. Links and connections are different claims: navigation does not assert a
software dependency.

Connection source, target, title and kind are required. Omitted status, description and evidence
normalize to `current`, the empty string and an empty array. Explicit `null` is invalid. At least
one endpoint must belong to the author; each foreign model must be declared by a link. Both
endpoints in the same model are invalid here: local relationships belong in LikeC4. Evidence
contains inert repository-relative paths; absolute paths, URI schemes, backslashes and parent
traversal segments are rejected. Evidence is neither read nor executed by this parser.

Authored compositions require an ID, title and projects array. Their root is implicitly the
owner, first and open; their projects array contains only distinct directly declared foreign
projects with required `open` or `collapsed` modes and optional scenes. An empty list is a valid
root-only authored composition. RootScene is optional. Duplicate link IDs, connection IDs and
composition IDs are rejected within their respective lists. IDs in different entity kinds or
owning projects can coincide.

Model IDs use the existing catalog's lowercase slug syntax. Local references are opaque nonempty
strings with no surrounding whitespace or control characters. Their existence and adapter-specific
validity are checked against resolved snapshots in phase 1; this parser never guesses by title or
source spelling. Unknown fields fail, including fields nested in targets and project entries.

## Identity and ownership

Public element references are `{ "model": "beacon", "element": "cli" }`; bridge identity is
`{ "ownerModel": "harbor", "connectionId": "invoke-beacon" }`. Local relationships, boundaries,
scenes, links and evidence retain their owning model. Distinct reverse or repeated claims keep
both owners. Source model hierarchy and trust membership remain untouched.

`qualifiedKey(kind, model, ...localIds)` encodes a JSON tuple. For example, the local element key
is `["element","beacon","cli"]`, while a host-owned bridge key is
`["connection","harbor","invoke-beacon"]`. Consumers treat keys as opaque strings, never split
on delimiters. Evidence may carry its owner's entity ID and evidence path as separate tuple
members. This function is an internal identity key, **not** a safe SVG/DOM ID encoder; phase 1 and
export work must namespace and escape element IDs and every fragment reference separately.

`IdentityOrigins` defines explicit/fallback maps for elements and relationships. It is a future
adapter snapshot contract. The existing LikeC4 adapter does not produce it yet. `links.from` and
connection endpoints must ultimately use explicit UIDs; metadata origin establishes that fact,
not matching an ID's spelling against a source path. The
[fixtures](../../../tests/fixtures/linked-projects/README.md) include an explicit UID equal to the
source ID and a fallback ID equal to its source ID. Their expected maps are hand-authored test
metadata, not supported companion files. Phase 1 must preserve and validate origin for real loads.

## Resolved composition state

`parseCompositionState(input)` accepts decoded state. A normalized example is:

```json
{
  "version": 1,
  "root": "harbor",
  "composition": "plugins",
  "projects": [
    {
      "model": "harbor",
      "scene": "overview",
      "mode": "open",
      "view": { "expanded": [], "proposed": false, "lens": "trust" }
    },
    {
      "model": "beacon",
      "scene": "overview",
      "mode": "collapsed",
      "view": { "expanded": ["core"], "proposed": false, "lens": "structure" }
    }
  ],
  "theme": "grove",
  "layout": "elk-layered",
  "selection": { "kind": "connection", "ownerModel": "harbor", "connectionId": "invoke-beacon" },
  "focusedProject": "harbor"
}
```

Version, root, projects, shared theme and shared layout are required. Projects must be nonempty,
distinct and root-first. The root cannot be omitted; it may be collapsed. Closing the root is a
future application action returning to ordinary root view, not a state with no root. Entry order
is significant for deterministic placement. Scene and authored composition IDs are optional
provenance/intent; the required explicit view is authoritative when replaying state.

Each project retains `expanded`, `proposed`, `lens` and optional `scope` from ordinary ViewState.
Expanded IDs are distinct; proposed is a boolean and lens is `structure` or `trust`. The shared
theme is `grove`, `graphite` or `midnight`; shared layout is the existing `elk-layered` or
`elk-layered-down` engine. Flow direction remains an engine property. Per-project theme/layout
fields are rejected, avoiding competing presentation defaults. A later scene-to-state resolver
fills these semantic fields from scenes before applying explicit saved overrides; parsing does
not load scenes or merge defaults.

Selection is one tagged object: `project` with model; `element`, `relationship`, `boundary` or
`scene` with model plus the named ID; or `connection` with ownerModel and connectionId. Its owner
must participate, as must focusedProject when present. Selection may refer to a hidden element
inside a participating project; future inspection/reveal validates its existence. A connection
may point at an unopened target while its owning project still participates.

Input exceeding 65,536 UTF-8 bytes of decoded JSON is rejected as `budget_exceeded`; this is a
state payload bound, not a change to model/project/cache admission limits. The future URL codec
must also bound input before decoding. State accepts no filesystem paths, DOM state, camera
coordinates, loader handles, resource-limit overrides or revision locks. It returns fresh records
and arrays; malformed input is never partially applied.

## Diagnostics

`CompositionContractError` reports `code`, `path` and message for malformed library input. Codes
are `invalid_contract`, `unsupported_version`, and `budget_exceeded`. Paths use dotted fields and
array indexes, or bracket-quoted names for unknown fields, so even unusual field names remain
unambiguous. This is distinct from a runtime target failure.

`parseCompositionDiagnostic(input)` verifies the future transport-neutral runtime envelope:

```json
{
  "code": "endpoint_missing",
  "ownerModel": "harbor",
  "connectionId": "invoke-beacon",
  "target": { "model": "beacon", "element": "removed" },
  "message": "The authored endpoint is missing.",
  "path": "links.connections[0].target",
  "recovery": "repair"
}
```

Every envelope requires code, ownerModel, message and recovery. LinkId, connectionId, path and
structured target are optional when relevant; target contains a model and optional element/scene.
Codes are `model_unavailable`, `model_invalid`, `unsupported_version`, `scene_missing`,
`endpoint_missing`, `identity_not_explicit`, `revision_changed`, `source_changing`, and
`budget_exceeded`. Recovery is one of `register`, `retry`, `repair`, `upgrade`, `reload`, or
`reduce`; the future producer chooses the appropriate action for the actual failure.

Budget-exceeded diagnostics require `budget: { resource, actual, limit }`, with finite nonnegative
counts; other codes reject budget fields. `not_loaded` is an ordinary reference state, not a
failure diagnostic. No resolver, revision checks, budget accounting, recovery behavior, error-to-HTTP
mapping or unavailable cards ship in phase 0.

## Contract proof and remaining implementation

Run the focused executable examples with:

```sh
node --import tsx --import ./tests/setup.ts --test tests/composition-contracts.test.ts
```

They compile the two small fictional models through the existing adapter, retain intentional
cross-project collisions, distinguish expected explicit/fallback identity metadata, exercise
ownership and parser errors, round-trip resolved state and diagnostics, and reject ambiguous
presentation overrides and oversized state. They do not prove linked diagram rendering.

Phase 1 adds loader integration, revision hashing, targeted resolution and real explicit UID
validation alongside CLI/HTTP/canvas wiring. Later slices add state URL replay, proposed/scene
projection rules, runtime limits, SVG namespaces and portable/export behavior. None should be
inferred from the successful phase 0 parsers.

## CLI and HTTP

Phase 1 ships a thin application boundary in `src/lib/server/composition.ts` that the CLI and the
HTTP routes both call; no resolution, validation or caching rule is duplicated in a handler. Only
the configured catalog is read: routes accept model IDs, never directories or URLs, while the CLI
keeps `--directory` as an explicit local entry point whose links resolve through the catalog.

- `linksFor(model, options)` returns the parsed links, the root revision and one
  `{ model, status, message? }` entry per distinct foreign model named by links or connections,
  resolved and validated individually without composing. Unknown roots throw.
- `validateLinked(model, options)` runs local `from`/endpoint existence and explicit-UID checks,
  then resolves the declared link closure with a visited set (a target's own links are followed
  only when it resolves) and a 20-model traversal budget (`budget_exceeded`, recovery `reduce`).
  Unresolved claims are diagnostics, never throws.
- `composeFromSelector(root, selector, options)` builds state from an authored composition ID or
  an explicit saved state (mutually exclusive), composes it, and caches by `compositionKey` — the
  canonical state plus the participating revision vector. `revisionConflict` compares a caller's
  vector with what was loaded.
- `inspectInComposition` and `searchInComposition` qualify results with their model; unopened link
  targets are never searched and appear as link metadata results.

CLI additions: `fractal links --model X [--json]`; `fractal validate --model X --linked` (exit 1
and diagnostics JSON when invalid); and `--composition ID` / `--composition-state FILE` on
`project`, `layout`, `inspect` and `search`. `layout` prints the full `ComposedDiagram`; `project`
prints it without per-project `diagram` geometry; `inspect --selection '<json>'` prints the
qualified inspection; `search` searches every participating model. Without the new flags every
existing command's output is unchanged.

HTTP additions: `GET /api/composition/links?model=X`, `POST /api/composition/validate { model }`,
and `POST /api/composition/render { root, composition?, state?, revisions? }`. Invalid input
(contract errors, unknown root, mutually exclusive selectors) is 400; a changed participating
revision is 409 with `{ error, code: 'revision_changed', model }`; an over-budget state payload is
422; recoverable target failures stay 200 with diagnostics in the body.
