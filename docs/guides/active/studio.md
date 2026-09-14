# Using the studio

The studio is the browser view of a Fractal model. Start it with `npm run dev -- --host 127.0.0.1 --port 5199`
or install the [local service](local-service.md). Every action here has a keyboard path; press
**?** in the studio, or run `bin/fractal shortcuts --json`, for the complete registry.

## Explore and present

- Use **+** on a component to reveal its children. Neighboring components retain their own depth.
- Hover over **+** for 750ms to peek inside without changing the view. Keyboard focus offers the
  same preview.
- Select a component or connection to inspect its meaning, provenance and underlying relationships.
- Use **Focus this component** for a readable deep view. The external-connections inventory keeps
  every relationship crossing the focus boundary available. Click the system breadcrumb to return.
- Choose **Trust** to see exact authored boundary memberships. **Diagram key** (the bottom-right
  information icon, or **I**) explains the legend, counts and boundaries and opens external
  connections. These describe the model, not enforced permissions.
- Enable **Proposed** to include planned elements and relationships.
- Use the **Flow** arrow in the bar, beside the theme, or **F**, to lay the view out top to bottom
  instead of left to right. The direction rides in the view link and in exports, like the theme does.
- Choose a saved perspective, then **Present**. Left/right arrows step through scenes; Escape exits.
- **Export** previews the actual 16:9 SVG artwork and downloads SVG or a 3840x2160 PNG.
- Choose **Grove**, **Graphite**, or **Midnight**. Themes travel with view links and SVG/PNG exports.
- Hide or show the left navigation using the sidebar button beside the project name, or
  **Cmd/Ctrl+B**.
- **Copy view link** preserves model, expansion, focus, lens, flow, theme and the inspected selection in
  the local URL, so a refresh or a shared link reopens the inspector on the same thing.
- **Model source** shows LikeC4, downloads source or view JSON, and reloads changed files.

Drag the background to pan; scroll, pinch, or use **+ / -** to zoom. The fit control beside the
navigation toggle, or **0**, resets the camera. The inspector floats over the canvas: drag its grip
to move it, and it reopens where you left it, at the size you gave it, on later selections and
later visits.
Use **Cmd/Ctrl+K** to search components, connections and saved views, including hidden or proposed
content. Jumping reveals the needed layers and brings the result into view. **Cmd/Ctrl+Shift+K**
opens project search when a catalog lists several projects.

Focus the canvas and use arrows, **HJKL**, or **WASD** to move between components. Enter inspects,
Space expands or collapses, and Backspace retreats a layer. In presentation mode, left/right arrows
step through scenes while HJKL/WASD explore components; Enter also toggles their detail. Backspace
retreats without leaving presentation; Escape exits. **Cmd/Ctrl+Enter** toggles presentation.
Use **+ / -** to zoom and **0** to fit. Selecting an outline entry brings it into view.

Canvas labels cannot be selected accidentally; copy text from the inspector. Motion respects the
system's reduced-motion preference. Source and export dialogs contain focus and support Escape.
Jump and shortcut dialogs also close when you click outside them.

## Explore sequences

Choose a journey under **Sequences**, or find it with **Cmd/Ctrl+K**. Start with an overview,
then unfold phases and participant groups, hide columns, or focus one phase. Summaries retain the
original message identities; hidden interactions stay explicit. The inspector links participants
back to architecture components. Themes, presentation, keyboard navigation and SVG/4K PNG exports
work across both views.

Sequences are authored scenarios, not captured traces. The current profile supports ordered
messages and nested presentation phases; alternatives, loops, concurrency and activation bars are
outside its scope. See the [sequence guide](sequences.md) for the versioned JSON contract, CLI/API
commands and authoring examples.

## Linked project diagrams

When a model declares `links.json`, its targets can share the canvas. Open one from the
**Open linked diagram** button in the source element's inspector, from a link result in
jump search, or with **Mod+Shift+L**; the target frame appears beside the source without
moving it. Each title band carries a menu for scene, focus, collapse, fit and standalone
opening, plus Close on non-root frames; the toolbar's **Close linked view** control
closes the whole composition. Bridges run between the visible endpoint representatives,
perimeter ports stand in for out-of-scope endpoints, and bridge inspection leads with the
readable route before exact identities and evidence. **Copy view link** carries the
composition in the URL; when a source changes, the studio holds its last coherent view
until you reload (**Mod+Shift+R**). Search reaches every participating project with
qualified results. See [Working with linked diagrams](usage.md) for the full journey,
including exports and the two refinements still in flight.

## Reload after editing

Edit the model files, then use **Model source > Reload model** (or **Reload sequence**). Render and
export requests check the loaded source revision, so a changed file cannot silently produce a graph
that disagrees with the inspector. Source files are read from the owning repository; neither the
dev server nor the installed service needs a rebuild for model changes.
