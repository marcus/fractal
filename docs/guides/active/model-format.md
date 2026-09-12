# Authoring a Fractal model

A project has two authored files: `model.c4` describes the software in LikeC4, and
`fractal.json` describes its presentation in Fractal. Both compile into the same
normalized model used by the browser and CLI. Geometry is computed separately.
Neither file is generated from source code.

Use `examples/delivery/` or `examples/observatory/` as a complete starting point.
The compiler validates the language, identifiers, relationships, boundaries and
saved scenes before presenting a model.

## Software structure and relationships

LikeC4 supplies arbitrary element kinds, nested containment and typed relationships.
Declare the kinds used by your model in `specification`:

```text
specification {
  element system
  element component
  relationship sends
  tag proposed
}
model {
  product = system 'Product' {
    metadata { uid 'product' }
    api = component 'API' {
      description 'Accept requests and coordinate work.'
      technology 'HTTP'
      metadata {
        uid 'api'
        fractalColor '#739886'
        evidence ['src/api.ts', 'docs/contracts.md']
      }
    }
    worker = component 'Worker' {
      #proposed
      description 'A proposed background processor.'
      metadata { uid 'worker' }
    }
    api .sends worker 'Dispatch work' {
      metadata { uid 'dispatch-work' }
    }
  }
}
views { view index { include * } }
```

Element descriptions appear in the inspector and on cards where space permits.
Keep the opening sentence short and useful. Relationship titles explain the action;
the relationship kind records its meaning independently of that wording.

### Fractal metadata

| Property       | Applies to                 | Meaning                                                                     |
| -------------- | -------------------------- | --------------------------------------------------------------------------- |
| `uid`          | Elements and relationships | Explicit stable identity, independent of nesting and display title.         |
| `fractalColor` | Elements                   | Optional six-digit hex color, such as `#739886`. Defaults to a muted green. |
| `evidence`     | Elements                   | One path/string or an array of evidence references shown in the inspector.  |
| `status`       | Elements and relationships | Optional `current` or `proposed`; tags are usually more convenient.         |

`color` is a reserved word in LikeC4 and is not accepted as a bare metadata key;
use `fractalColor`. Other LikeC4 metadata may remain in the authored file, but the
initial Fractal normalized model only carries the fields above. For example,
`verifiedRevision` is not yet a tracked field or a freshness check.

IDs use letters, numbers, dots, underscores, colons and hyphens, starting with a
letter or number. Element IDs must be unique among elements; relationship IDs must
be unique among relationships. Each `uid` is a single string. A duplicate or
multi-valued ID fails validation.

Fractal can import unannotated LikeC4: element IDs then fall back to hierarchical
source names, and relationship IDs to LikeC4's generated IDs. Those fallback IDs
can change when the model is reorganized or edited. Use explicit `uid` values for
anything referenced by a boundary, scene or long-lived external link. All bundled
examples use explicit identities.

### Current and proposed status

Use `#proposed` for a planned capability. `#current` or `#built` explicitly means
current; declare any tags used in the LikeC4 specification. Untagged elements are
current unless their parent is proposed, in which case they inherit proposed status.
A child cannot declare itself current inside a proposed parent. Contradictory tags
or metadata fail validation.

A relationship touching a proposed endpoint is proposed even if its own declaration
omits that tag. A proposed relationship between current elements can be tagged
separately. This keeps the current-only view from implying that a planned path exists.

“Current” is an authored claim, not a runtime check. Evidence references are carried
as text; the compiler does not open them, verify the code or prove the claim.

## Presentation companion

`fractal.json` contains no element or relationship definitions. Its versioned shape is:

```json
{
  "version": 1,
  "id": "product",
  "title": "Product",
  "description": "From a request to completed work.",
  "provenance": "Authored from the system README on 2026-09-09.",
  "boundaries": [
    {
      "id": "private-network",
      "title": "Private network",
      "description": "Internal components share this network boundary.",
      "kind": "network",
      "members": ["api", "worker"],
      "color": "#739886"
    }
  ],
  "scenes": [
    {
      "id": "overview",
      "title": "The big picture",
      "description": "Start with the whole system.",
      "expanded": [],
      "proposed": false,
      "lens": "structure"
    },
    {
      "id": "inside",
      "title": "Inside the product",
      "description": "Reveal the request path and its proposed worker.",
      "scope": "product",
      "expanded": ["product"],
      "proposed": true,
      "lens": "structure"
    }
  ]
}
```

The top-level fields shown are required. `boundaries` may be empty; `scenes` must
contain at least one scene. Unknown top-level fields fail validation so misplaced
software definitions cannot silently become a competing model.

Boundaries describe memberships, not structural parents. The same element may
belong to several boundaries. A boundary has a unique ID, a non-empty list of
existing element IDs and an optional six-digit hex color. `kind` is descriptive
text, such as `network`, `permission` or `ownership`. Boundaries are architectural
claims; drawing one does not enforce a permission or isolate a network.

### Saved scenes and focus

Each scene stores a named perspective on the same model:

- `expanded`: exact element IDs to open. Each must have children.
- `proposed`: whether planned elements and relationships are visible.
- `lens`: `structure` or `trust`.
- `theme`: optional `grove`, `graphite`, or `midnight`. CLI/export defaults to Grove; the studio
  retains its selected theme when a scene omits this field. Explicit scene themes override it.
- `scope`: optional element ID that anchors a focused view. Omit it for the whole model.
- `layout`: optional layout engine id, from `bin/fractal engines --json`. Omit it for the default
  left-to-right layered layout (`elk-layered`); `elk-layered-down` lays the same view out top to
  bottom, which suits portrait pages, tall screens and README embeds. An unknown id fails
  validation.

A scope must exist and be visible under the scene's proposed setting. Expanded
nodes must be the scope itself or its descendants. Include each ancestor needed to
reach an expanded descendant, stopping at the scope; ancestors outside the scope do
not need to be expanded. For a scene without scope, include ancestors all the way to
the root. Unknown references, repeated expanded IDs and expanding a leaf fail validation.

For example, a nested API with its own children can use `scope: "api"` and
`expanded: ["api"]` without opening its enclosing product first. This expresses a
presentation focus, not a new model hierarchy or copied subgraph.

The prototype focuses through authored scenes and computes its visible context from
the shared model. It does not yet support a general query language, source-code drift
analysis, round-trip visual editing or arbitrary scene animation timelines.

## Language dependency

The initial adapter uses LikeC4 1.59.3. It consumes the public model API and does not
fork the grammar or depend on LikeC4's renderer. The normalized model is owned by
Fractal, so another authoring adapter can be added without replacing the canvas.

See the [LikeC4 language guide](https://likec4.dev/dsl/model/) and
[relationship guide](https://likec4.dev/dsl/relationships/) for additional syntax.
Not every LikeC4 rendering feature or view rule is mapped into Fractal; the companion
scenes are the authoritative presentation configuration for this prototype.

## Sequence companions

Optional `sequences.json` lives beside these two files and references normalized architecture
element IDs. It has its own versioned authoring adapter and ordered projection; it does not change
LikeC4 grammar or turn temporal messages into structural relationships. See the
[sequence guide](sequences.md) for the supported profile, CLI/API, and folding semantics.
