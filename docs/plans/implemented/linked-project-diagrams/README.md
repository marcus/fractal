# Phase 0 visual proposal

Open [proposal.html](proposal.html) directly in a browser. It is a self-contained design aid with no
network requests, dependencies, or production UI wiring. The controlling contract and delivery
sequence live in the [linked project plan](../linked-project-diagrams.md).

The drawing is an **illustrative subset**, not an export of the complete Sidecar or td models.
Sidecar's `plugins.td` → td's `monitor` bridge represents the verified in-process
`monitor.NewEmbeddedWithOptions` call. The proposed cross-project connection is owned by Sidecar.
The generic plugin-host node provides visual context, not a new authored stable identity.

Recall currently has no Fractal model in the inspected checkout, and Sidecar's current model lacks
a Recall integration element. The proposal labels that model addition and shows an unavailable
diagram reference. It does not invent a Recall endpoint or draw that reference as an asserted
software dependency. Recall supports the Sidecar plugin protocol independently of this missing
diagram. Source-owned model authoring remains a prerequisite for the complete steel thread.

## Interaction decisions

- A quiet solid project frame expresses ownership, independently of the dashed Trust membership
  inside Sidecar. The membership is illustrative; neither frame implies enforced access.
- Collapsing td retains its project title position and redirects the bridge to the project summary.
  The selected connection still exposes its exact `{model, element}` endpoints. Reopening td
  restores its local view without moving Sidecar or changing the canvas scale.
- One inspector leads with readable routes, then exposes exact identities and evidence through
  native disclosures. Selecting the unavailable Recall reference presents concrete recovery steps.
- Native controls support keyboard and touch: collapse/reopen td, toggle Trust, select the bridge,
  inspect the unavailable target, and choose Grove, Graphite, or Midnight.
- The palette values come from `src/lib/core/themes.ts`; the card title/description scale follows
  `src/lib/core/node-metrics.ts`. The prototype uses the system font stack and loads no fonts.

## Prototype limits

Geometry is deliberately fixed HTML/SVG for review. There is no production composition loader,
layout engine, pan/zoom, search, URL state, export, or performance claim here. The frozen coordinates
demonstrate project-title stability and endpoint representation; they do not establish the eventual
frame-placement algorithm. Production will use the shared core and studio camera, not this markup.

On a narrow viewport the canvas scrolls horizontally at a readable scale and the inspector follows
below it. A focusable canvas and native Tab navigation provide keyboard access to offscreen controls.
This prototype's inspector breakpoint preserves the drawing's legibility; it does not change the
studio's existing mobile-sheet contract. There are no animated transitions, including under reduced
motion. The file can be opened offline.

## Visual proof

Verified with headless Chromium 153.0.8010.12 on 2026-09-13, using the local file directly:

- Desktop at 1500 × 900: Grove open projects and precise endpoint disclosure; Midnight collapsed td
  with unchanged Sidecar geometry; Graphite with unavailable Recall selected.
- Mobile at 390 × 844 with reduced motion: Grove and Midnight, plus a horizontal scroll to the td
  and Recall targets. Only the canvas scrolls horizontally; the page and inspector fit the viewport.
  The legend stays above the inspector without overlap.
- Native Enter/Space collapse and reopen td; keyboard selection opens bridge inspection. Reveal
  Monitor reopens td and restores focus to its component button. Trust changes membership visibility
  while leaving ownership frames visible. All three theme choices work. No page errors occurred.
- Rechecked the final copy and screenshots after aligning the connection kind with `embeds`, keeping
  current integration status distinct from proposed functionality, and improving narrow layout.

Screenshots are local proof artifacts, intentionally outside tracked documentation, in
`artifacts/linked-project-phase0/`: `proposal-desktop-grove.png`,
`proposal-desktop-midnight-collapsed.png`, `proposal-desktop-graphite-unavailable.png`,
`proposal-mobile-grove.png`, `proposal-mobile-midnight.png`, and `proposal-mobile-targets.png`.
