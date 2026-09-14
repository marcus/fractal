# Fractal design

Fractal helps people understand and explain software. The diagram is the primary experience;
navigation helps readers find their place, and inspection reveals the evidence behind what they see.
Aim for presentation-quality clarity at every level of detail.

Read this before changing the studio's layout, typography, navigation, inspection, or exports.
These are design defaults distilled from approved work, not a frozen component specification.
When a different choice serves a real journey better, explain the consequence and show it in context.
[AGENTS.md](AGENTS.md) governs engineering workflow; the [active plan](docs/plans/active/fractal.md)
governs scope. This document explains how the product should feel and how to make consistent decisions.

## The standard: crisp and tight

The studio reached a look that reads as finished: a full-bleed canvas, a few floating cards, quiet
controls, and text that sits directly on the drawing. Every change should leave it at least this
crisp. The test for new work is subtraction: if a row, border, label, background, or heading can
be removed without losing a decision the reader has to make, remove it.

- One idea per control, one signal per state. A caret folds, a name toggles, a dot or a struck name
  carries the state. Do not add a second column that repeats what the first already says.
- Controls are quiet until needed. Hover fills replace resting backgrounds; borders are for cards,
  not buttons. Keyboard focus stays clearly visible because it is an accessibility cue, not chrome.
- Text sits on the canvas, not in bands. Where the diagram can pass beneath text, a soft halo in the
  surface colour separates them; a card, border, or per-letter shadow would be too much.
- Explain on demand. A short delayed tooltip carries the explanation that a permanent label used to
  carry. Tooltips are a courtesy for pointer users, never the only path to a capability.
- Icons are drawn once. Element kinds use purpose-drawn, 16px outlines in the same rounded language as Roc
  section markers and controls. Glyphs that also appear in exports live as shared markup in the
  core so canvas and SVG agree.

## A bar over a full-bleed canvas

The studio is a bar over a canvas that fills the window. Navigation and the inspector float over
the canvas as cards, so opening, moving, resizing, or folding chrome never resizes or refits the
diagram. Fitted diagrams use the uncovered area; selections reveal clear of the panels.

- The bar is air. Only its clusters take the pointer: the title and crumbs at the left, the actions
  and project switcher at the right. The canvas shows between them.
- The perspective or journey title, its focused ancestry, and the subtitle live in the bar as
  breadcrumbs with usable paths back out. The canvas heading returns only for presentations.
- Panels are cards with a grip. Drag the grip to move, drag an edge to resize, double-click the grip
  to fold the panel to its title, and use the close control in the grip to hide it. The inspector
  remembers where it was dragged, with its size, and reopens there. The navigation toggle and
  the fit control keep the bottom-left corner as one quiet card each, with no resting border; the
  wordmark keeps the bottom-right. Zooming is a gesture or a key, not a button: a percentage of
  nothing in particular is not a control.
- The selection is view state. It rides in the link beside expansion, focus, lens, and theme, so a
  refresh or a shared link reopens the inspector on the same element, connection, phase, or lane.
- Trust and Proposed are compact switches on one row with the search at the far right. They are
  independent choices, not modes; Structure is the ordinary Trust-off view.
- Flow direction belongs in the bar's action cluster, beside the theme, not on that row: it is a
  presentation choice about how the same model is arranged, not a choice about which parts of the
  model are shown. It is an arrow pointing the way the diagram runs — right for the default
  left-to-right placement, down for the top-to-bottom one — tinted with the accent only when the
  view has left the default. The arrow is the whole signal; no label repeats it, and the delayed
  tooltip, the accessible name and the registered key carry the explanation. Like the theme, it
  rides in the link, the scene and the export, and switching it re-renders through the ordinary
  path.
- Search opens straight on its input. No heading, no close button: Escape and a click outside
  dismiss it, and the footer shows the keys. The shortcut sheet closes the same way. The project
  switcher opens on the project you are in, so Enter and Escape both leave you where you were.
- The wordmark is text. Hover or activation reveals its compact project links; click or touch pins
  them, keyboard activation moves into them, and Escape or an outside click dismisses them. Its only
  visual flourish is a wash of accent colour through the letters and a soft glow. Reduced motion
  keeps only the glow.
- Below 761px the navigation is a sheet from the bar's menu button and panels are not moved.

## Nodes

An architecture node is a card with a title row, then the description. The title row ends in the
element's kind icon and, for containers, the expand control. Nothing else sits in the card.

- The kind is an icon, not a row of text. Hovering it, after a short delay, explains the kind in one
  line; the readable kind still reaches assistive technology and the inspector.
- The expand control has no resting background. It fills on hover, and its caret is the only
  thing that changes between expanded and collapsed.
- Proposed elements draw dashed in their colour and say so in the kind tooltip and inspector.
- Density comes from one shared metric profile so measurement, canvas, and export move together.

## Quiet navigation that continues naturally

A sidebar should read as a coherent outline. New sections should inherit the rows, gutters,
indentation, type scale, and section spacing around them, rather than introduce a miniature form.

Section headings share one text treatment. Use a small, decorative icon beside each section name
to support scanning; only disclosure chevrons rotate. Breadcrumb separators belong between items,
never before the first item.

Use background and text changes for hover and selection. Navigation buttons in the sidebar and
appbar do not acquire visible hover borders.

Perspectives and Sequences are top-level navigation sections. On architecture views, Structure
belongs beneath Perspectives, before Sequences, and folds with that section. Its Show all action
expands the current scope without changing proposal visibility. Keep long outlines scrollable so
sequence navigation and Model source remain reachable. Phases and Participants belong to
the selected sequence: nest and indent their controls beneath its journey list, use sentence-case
subheadings, and hide them with the Sequences disclosure. Preserve their state while collapsed.
Use spacing and typography for this hierarchy, without enclosing cards or connector lines.

Phases and participants share one row grammar: a fold caret, a state mark, the name, and Only on
hover. Names sit a few pixels in from the heading text so the list reads as a continuation of its
heading, and nested rows indent by one step. Clicking the name toggles visibility; a parent name
toggles its whole subtree, and a minus marks a partial one. Hidden rows swap the mark for an eye-off
and strike the name. Participants keep their lane colour as the mark. Touch users must have access
without hover.

Each section heading carries its count, an explicit Show all, and a fold-all caret. Show all reveals
every row and unfolds it, as the Structure outline's Show all does; the caret beside it folds or
unfolds without changing visibility. Keep visibility separate from folding. Preserve ancestor context
for selected children, and keep selection in shared view state so browser links, CLI, and exports agree.

Keep a group heading on one line. Use indentation to express membership, without a vertical grouping
rule or a redundant count subtitle. A folded group may show its member count because the members
are no longer visible. Put occasional actions such as Combine/Separate lanes in a small, labeled
ellipsis control. Do not make secondary controls compete with the names people are scanning.

Keep the Model source button; put its filename in the tooltip. Show implementation metadata on
request unless it changes the reader's immediate decision. Essential actions and state must remain
available through keyboard, touch, and accessible names, not tooltips alone.

## Lead with meaning, reveal the rest

Scannability and completeness should coexist. Order inspection content by the questions a reader asks:

1. **What is selected?** The kind icon the node carries, a clear title, a useful description, and a
   compact count or route when relevant. The icon explains itself on hover, as it does on the
   canvas; the readable kind reaches assistive technology and Technical details. An additional
   “Inspector” heading adds no information.
2. **What happens here?** For phases and summaries, show numbered interactions in authored order.
   Lead with the interaction title and readable participant names, not IDs. Expand each interaction
   to reveal its description, kind, stable identity, and exact endpoints.
3. **How can I inspect it precisely?** Put IDs, membership identifiers, parent phase IDs, and original
   counts under Technical details. Preserve the exact values for agents and debugging.
4. **What supports this claim?** Put the full authored provenance under Sources & context. Preserve
   its qualifications and evidence pointers; do not invent structured evidence by guessing at prose.

Use spacing and typography to separate groups before adding horizontal rules. A panel should not
look like a stack of tiny bordered cards. Keep titles readable and allow them to wrap.

Adapt the hierarchy to the selection. A single message already has a title, route, and description;
do not repeat it in a one-item interactions list. Participant groups show readable member names and
descriptions. Architecture links are useful next actions and remain visible, not buried with IDs.

Progressive disclosure must not conceal what changes the interpretation. Keep hidden-interaction
counts and omission labels visible before expansion. Current/proposed meaning, grouped participants,
and authored-model limitations must remain honest across navigation, inspection, and exports.
A boundary describes membership; it does not imply enforced access. A presentation phase does not
imply concurrency or control flow.

Architecture and sequence inspectors share their header, typography, and native disclosure controls.
Components keep status, technology, child navigation, boundary names, and directed connections visible.
Connection routes navigate immediately; disclosure reveals descriptions and exact identities. Boundary
explanations open individually. Technical details and Sources & context start collapsed and reset with
selection. Keep presentation disclosure local; the shared inspection core preserves the full data.

## Readable typography and measured density

Create a refined appearance through proportion, alignment, restrained emphasis, and room to read.
Do not equate “premium” with tiny text, heavy weights, tight tracking, or additional ornament.

- Titles in the bar use slightly open tracking. The current reference is `0.01em`; avoid inheriting
  the strongly negative spacing intended for larger headings or the wordmark.
- Let the subtitle use the actual available width. Ellipsis is for genuine overflow, not an
  arbitrary width cap that leaves usable space empty. The subtitle gives way first when space is short.
- Reduce surplus padding before reducing label size. Preserve legible text and useful interaction targets.
- Measure wrapped content before layout. The longest visible participant title determines the shared
  header height, so every lane starts on the same baseline and wrapped labels still fit.
- Keep short phase titles and descriptions on one baseline when they fit. Use quiet bands for top-level
  phases and lighter underlined subheaders for nested phases. Hierarchy should be visible without
  giving every level an equally heavy box.
- Keep arrow geometry restrained and deliberate. The gently rounded self-return path is shared
  between the canvas and export, not approximated independently in each renderer. Reserve the full
  loop height below measured text so a return cannot cross wrapped titles or descriptions.

Architecture density and sequence density have separate shared metric definitions because their
content differs. A one-line sequence header is 44 model units tall; an architecture card's title row
starts 32 units down and its controls sit in a 24-unit row at the top right. These are reference
outcomes, not mandates to shrink every component by the same amount.

## Linked projects share the canvas

When several repository-owned models share the canvas, each project reads as one calm
frame: a quiet solid perimeter in theme tokens with a measured title band on the canvas,
not a nested toolbar. The frame is presentation geometry — it claims no trust, no
permission, no new parent. Trust memberships stay a distinct optional lens inside each
frame, never inherited from a host by its plugin, and the dashed proposed treatment is
never reused to mean "another repository". Project identity stays visible in the
ordinary Structure view.

Bridges run in the theme edge color from the visible representative of each endpoint,
with the arrow direction retained at every detail level and a halo that separates the
line from the ground beneath it, like canvas text. Current bridges are solid; proposed
bridges are dashed and say so in the inspector. Bundles carry a `×N` count rather than
merging unrelated claims. Endpoints outside a project's scene scope land on labeled
perimeter ports with an outside-scope count and a reveal action — ports are clearly not
components. A collapsed project keeps a titled summary with its connection anchors, and
reopening restores its last view. Unavailable targets are honest cards with a recovery
step, never fabricated components.

Bridge inspection follows the same lead-with-meaning order as everything else: the
readable project/component route first, then the claim description, then exact
`{model, element}` endpoints with the drawn representative reported separately, then
source evidence under its disclosure. Frames, ports and bridges share the selected
theme; UI chrome never reaches exports, and every SVG identity is namespaced per
project so colliding local IDs cannot collide on the canvas.

## Preserve the reader's place

Separate model meaning, a shareable view, and the reader's workspace preferences.

| State                                                                               | Where it belongs                                  | Design consequence                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Authored elements, relationships, phases, memberships, provenance                   | Project-owned model                               | Stable identities survive presentation changes.                                                        |
| Diagram phase folding, combined lanes, participant visibility, focused phase, theme | Shared view and its existing URL/CLI/API contract | A copied link reproduces the intended projection.                                                      |
| Panel visibility, position, size, and folding; Perspectives/Sequences disclosure    | Optional browser preferences                      | Shared links do not dictate another person's panel layout.                                             |
| Participant-list disclosure; inspector disclosure; tooltips                         | Local interface state                             | Folding the list does not combine lanes or hide model content. Inspector detail resets with selection. |

Restore remembered chrome before first paint. Do not flash a panel open and then animate it away.
Both diagram surfaces honor the same preferences, and unavailable browser storage is harmless.

Animate deliberate transitions to maintain orientation, not to decorate initial rendering. Respect
reduced motion. Opening panels, resizing navigation, or resizing the window should not unexpectedly
zoom the diagram out. Preserve camera scale and position on viewport changes; explicit Fit and
deliberate presentation transitions can reframe it.

When a reader expands or collapses an architecture component, follow its title through the layout
transition at the current drawing scale. Keep the title at its screen position rather than tracking
the center of a growing container. Apply this to canvas, outline, inspector, and keyboard toggles;
manual pan, zoom, Fit, or navigation takes over from following. Larger containers can extend beyond
the viewport: Fit remains the explicit way to see the whole composition.

Do not conflate similar-looking controls. In the phase tree, the caret folds the diagram's phase and
the title focuses that phase. In Participants, the caret folds the sidebar list, the group name
hides or shows its members, and the lane menu combines lanes in the diagram. Keep these different
effects understandable and independently testable.

## One behavior, appropriate surfaces

UI refinements must preserve the model's headless paths. Reuse existing projection and view-state
handlers for visibility, grouping, and focus. Local disclosures need no new model schema or CLI flag.
Keep the business behavior outside view components and preserve exact identities behind readable labels.

Geometry that affects the model artwork belongs in the shared layout/metrics layer. A padding change
must reach measurement, canvas rendering, and SVG/PNG export together. Do not squeeze SVG rectangles
with CSS while leaving layout and text baselines unchanged. Collapse and hiding must retain relationship
provenance and make omissions inspectable. Editor controls stay out of exports; kind icons stay in.

Use the existing Grove, Graphite, and Midnight tokens. New UI should inherit the selected theme;
do not paste a Grove palette from a proposal into production components. Dark themes need lighter
touches: the text halo is weaker there because it only has to separate, not clear the ground.
Use the Roc icon library. Native buttons, details/summary, dialogs, and popovers are preferred when
they provide the interaction. Register application shortcuts centrally; native Enter, Space, Tab,
Escape, text entry, IME, and focus behavior must retain their appropriate ownership. Escape in a lane
popover closes that popover without also clearing the focused phase underneath it.

## How to make the next design decision

Start from the actual model, URL, viewport, panel state, and theme the reader is using. Inspect the existing
shared component and affected renderers before proposing another pattern.

For a small, clear adjustment, make the scoped change and show it live. For a broad hierarchy or
interaction redesign, show a compact interactive proposal with real content and the surrounding visual
language, iterate on the useful choice, then implement the approved behavior. A proposal is a decision
aid; it does not establish a new production capability by itself.

Check the affected journey, not only an isolated component:

- Inspect the result at the supplied view, with relevant panels open and closed; check narrow layouts
  and long labels when the change affects available width or wrapping.
- Check default, hover, keyboard-focus, expanded, collapsed, selected, and hidden states as applicable.
  Prove keyboard and pointer behavior, including focus restoration and dismissal.
- For geometry changes, verify wrapped content, containment, live/export parity, and omission summaries.
  Inspect actual exported artwork when its appearance changes.
- Check both light and dark themes when a change touches anything drawn over the canvas.
- Preserve the user's current working view. Use an isolated tab for disruptive proof if the user is
  actively exploring or annotating the main tab.
- Follow the checks and review requirements in AGENTS.md. After application changes, reinstall the
  local studio and confirm service health so the visible result is the build just reviewed.

For documentation-only changes, check the document and its links; an application reinstall is unnecessary.
Update this guide when an approved decision changes the direction. Keep it as current guidance,
with implementation pointers rather than a diary or an ever-growing list of pixel exceptions.

## Implementation references

| Concern                                           | Start here                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio layout, typography, navigation styles      | [src/app.css](src/app.css)                                                                                                                         |
| Floating panels: move, resize, fold, insets       | [floating-panel.ts](src/lib/ui/floating-panel.ts)                                                                                                  |
| Shared rail, view controls, and section controls  | [ModelNavigation.svelte](src/lib/components/ModelNavigation.svelte)                                                                                |
| Delayed tooltips                                  | [tooltip.svelte.ts](src/lib/ui/tooltip.svelte.ts), [TooltipHost.svelte](src/lib/components/TooltipHost.svelte)                                     |
| Element kind icons and hints                      | [kind-icons.ts](src/lib/core/kind-icons.ts)                                                                                                        |
| Optional personal state and pre-paint restoration | [preferences.ts](src/lib/ui/preferences.ts), [app.html](src/app.html)                                                                              |
| Sequence outline rows                             | [SequencePhases.svelte](src/lib/components/SequencePhases.svelte), [SequenceParticipants.svelte](src/lib/components/SequenceParticipants.svelte)   |
| Progressive inspector hierarchy                   | [InspectorContent.svelte](src/lib/components/InspectorContent.svelte), [InspectorDisclosure.svelte](src/lib/components/InspectorDisclosure.svelte) |
| Architecture density                              | [node-metrics.ts](src/lib/core/node-metrics.ts)                                                                                                    |
| Sequence header and self-message geometry         | [metrics.ts](src/lib/sequence/metrics.ts), [layout.ts](src/lib/sequence/layout.ts)                                                                 |
| Live canvases                                     | [DiagramCanvas.svelte](src/lib/components/DiagramCanvas.svelte), [SequenceCanvas.svelte](src/lib/components/SequenceCanvas.svelte)                 |
| Export rendering                                  | [core/svg.ts](src/lib/core/svg.ts), [sequence/svg.ts](src/lib/sequence/svg.ts)                                                                     |
| Themes and keyboard contract                      | [themes.ts](src/lib/core/themes.ts), [shortcuts.ts](src/lib/core/shortcuts.ts)                                                                     |

Basis: the September 10 and 11, 2026 design iterations. The floating studio shell (`212856f` and the
`experiment/floating-layout` series before it) set the bar, cards, grips, and corner controls; the
sequence outline rows, title halo, and wordmark (`140ae86`) and the node kind icons, tooltips, and
search row that followed set the current level of finish. Earlier decisions on sidebar persistence,
participant navigation, typography density, and progressive inspection still hold where this document
repeats them. Current source and subsequent approved decisions take precedence.
