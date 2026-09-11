# Shared model and surfaces

Fractal has four separate representations:

1. **Authored source**: LikeC4 and the Fractal companion. Stable IDs, component hierarchy,
   relationships, status, evidence, boundary membership, scenes, and provenance.
2. **Normalized model**: versioned TypeScript records with no UI, filesystem, or layout types.
3. **Projection**: which components are visible, where hidden endpoints roll up, and which exact
   relationships cross a focused view. A projection never changes the source.
4. **Geometry**: node bounds, wrapped labels, ports, routes and canvas extent. ELK owns this step;
   the renderer receives geometry and adds interaction or an editorial frame.

The source is the authority. Its hash binds browser render/export requests to the loaded model.
When files change, the operator reloads; Fractal refuses to combine old inspector data with new
geometry. State is inspectable files, not a database.

## Capability matrix

| Capability                            | Browser                   | CLI                              | Local HTTP              |
| ------------------------------------- | ------------------------- | -------------------------------- | ----------------------- |
| Compile + validate                    | Load/reload model         | `validate`                       | `GET /api/models/:id`   |
| Inspect model/source                  | Inspector + source dialog | `inspect`                        | `GET /api/models/:id`   |
| Select expanded/focused/proposed view | Canvas, scenes, toggles   | `project`, flags                 | `POST /api/render`      |
| Inspect external connections          | Focus inventory           | `project` / `layout` → `outside` | Render response         |
| Inspect geometry                      | Canvas                    | `layout`                         | `POST /api/render`      |
| Save view configuration               | Copy link / JSON download | Model scenes / view flags        | Render state payload    |
| Export SVG                            | Export dialog             | `export`                         | `POST /api/export`      |
| Export PNG                            | Browser rasterization     | `export --format png`            | SVG + client rasterizer |
| Navigate presentation                 | Present, arrow keys       | Scene selection + export         | Same state per scene    |

Pan, camera zoom, selection, focus management and animation timing are presentation mechanics.
They do not change architectural meaning. Model authoring uses the existing text-file tools;
there is no privileged visual editing path.

The HTTP adapter is local and unauthenticated. It exposes only IDs beneath the configured model root (`FRACTAL_MODELS_DIR`, or `examples/` by default),
not arbitrary filesystem paths. The CLI can deliberately read an explicit directory. Hosting,
authentication, remote editing and collaboration are separate future product journeys.

## Model rules

- Stable IDs are independent of source names when explicit `uid` metadata is supplied.
- The model has one structural parent per element; boundary membership may overlap.
- Current/proposed state is explicit. A proposed parent hides its descendants in current-only views.
- Collapse maps hidden endpoints to visible ancestors and preserves original relationship IDs.
- Distinct relationship claims remain distinct even if they share projected endpoints.
- Focus shows a subtree and inventories crossing connections. Relationships entirely outside the
  view are irrelevant to that projection, but remain in the model.
- Trust colors describe exact authored membership. Fractal does not infer permission enforcement.
- Source references are evidence pointers. Their presence does not certify that the model is current.

## Presentation state

Themes are named, shared palettes in `core/themes.ts`: Grove (the original), Graphite, and Midnight.
Optional `ViewState.theme` defaults to Grove for existing files and CLI views. The studio retains
its chosen theme across scenes that omit a theme; an explicit scene theme overrides it. Palette
selection changes presentation only, never authored component colors, status, or membership.
CLI `themes --json` lists tokens; `--theme` selects the same palette used by browser and exports.

Spatial navigation and outward transitions are deterministic functions in `core/navigation.ts`.
The canvas owns camera interpolation and focus. Outline selection reveals the matching geometry;
Escape collapses the active component/parent or exits its focused scope. Peeks use the same
current/proposed-aware inspection function as the inspector and CLI, without requesting new layout.

## Presentation and dependencies

Node cards and SVG share fitting and geometry. SVG has no foreignObject, script, font request,
or external image dependency; PNG freezes the portable-font rendering at 4K. Long slide headings
and legends use bounded text with ellipses, preserving full authored text in the model/metadata.

The canvas is two-dimensional SVG with finite, interruptible interpolation. It honors reduced motion.
Physics is not responsible for layout. Whole-system deep graphs may need pan/zoom; focused views
are the first solution to useful slide proportions.

LikeC4 is the compiler adapter; ELK is the geometry adapter; SvelteKit is the local shell. Playwright
is used for verification and headless PNG export. Roc supplies UI icons. A cookie package override
updates SvelteKit's transitive serializer to the patched compatible 0.7 series; this prototype does
not implement sessions or authentication.

## Where things live

```text
LikeC4 + companion JSON → language adapter → model → view projection → ELK layout
                                            ↑                         ↓
                                    CLI / local HTTP API       canvas / SVG / PNG
```

- `src/lib/core`: model records, projection, text fitting, search, shortcuts, portable SVG.
- `src/lib/sequence`: the separate temporal model, layout and SVG for sequence journeys.
- `src/lib/adapters`: LikeC4 compilation, ELK geometry, headless PNG rasterization.
- `src/lib/server`: file-backed model loading, catalog resolution and revision identity.
- `src/routes/api`: thin model, render and export endpoints.
- `src/lib/components`: the animated canvas and studio shell; geometry comes from the shared core.
- `scripts/fractal.ts`: the noninteractive CLI; `scripts/service.mjs`: the installed local service.

The browser never runs the architecture parser or layout engine. It receives an inspectable
model and geometry; rendering and animation do not own architectural meaning.
