# Fractal product direction

The initial prototype is the working reference. Keep iteration centered on the experience of
understanding and explaining a system. Do not treat the experimental profile as a public standard.

## Durable product principles

- Model meaning is the asset; diagrams, scenes, prose and agent context are projections.
- Structural containment, network zones, permission boundaries and ownership are separate concepts.
- A user may inspect different depths simultaneously and return without losing orientation.
- Agents operate on the same stable IDs, relationships and validation as the graphical application.
- Architecture explanations are authored claims with provenance. Code links can aid maintenance
  without making inferred code structure the source of truth.
- Current and proposed behavior must remain distinguishable in both exploration and exports.
- Presentation quality includes composition, readable typography, clear connections, graceful motion,
  accessibility, and predictable output in other tools.
- Generalize only against substantially different real examples. Example-specific rendering is a bug.

## Questions for the next visual iteration

1. Expansion follows the toggled component's title at the current drawing scale. What additional
   layout locality would improve revealing detail in place?
2. Should focused views show explicit external port cards in addition to the connection inventory?
3. Which compositions work best for technical walkthroughs versus a client proposal?
4. How much direct placement should an author control while preserving automatic collision avoidance?
5. Can overlapping boundary lenses remain clear at greater graph density?
6. What is the smallest reusable story format for narrated video and presentation sequences?

Next work should follow feedback on the running studio. Likely research areas include
layout constraints/locality, composition presets, per-scene annotations, and model maintenance
workflows. General editing, structural diffs, code-drift checking and additional language adapters
remain deliberate future scope.

## Standard direction

Keep the normalized model versioned and modest. Prove the profile on multiple projects before
freezing syntax or compatibility. LikeC4 reuse is the current decision; interchange adapters should
map to the same semantics. The project is open source under Apache 2.0.
The model format remains experimental; document incompatible changes before freezing a versioned
compatibility promise.

## Open source baseline

The repository provides a portable clone-to-studio path, agent authoring instructions, a real
studio screenshot, fictional public examples, dependency license attribution, and CI matching
the documented checks. The logo flyout links to GitHub and Haplab with keyboard, touch,
theme and reduced-motion support. Roc 0.2.1 includes its MIT license.

The first public snapshot excludes private development history. Release verification includes
97 unit tests, 64 browser checks, type checking, production build, and three installed-studio
checks covering project switching, source reload, sequences, and SVG/4K PNG export. The fictional
model and flyout received independent reviews. The installed service uses the neutral
`local.fractal.studio` label. Model format stability remains an open product decision.

## Navigation and catalog

The studio supports spatial keyboard navigation, outline camera reveal, collapsible navigation,
read-only component peeks, three shared themes, and jump search across current and proposed content.
A shared registry owns shortcuts, help and CLI discovery. Presentation keeps its story position
while readers explore. Project catalogs reference repository-owned models without copying them.
The [Fractal skill](../../../skills/fractal/SKILL.md) explains the agent workflow; the
[local service guide](../../guides/active/local-service.md) explains the persistent studio.

## Shared studio shell

Architecture and sequence views are one studio with two diagram types, not two applications.
They share the grid, appbar, sidebar component, inspector header and disclosure components, modals and toast.
Both inspectors lead with readable meaning and navigation, keeping exact identities and full authored
source context in collapsed sections. Component connection routes remain directly navigable; boundary
explanations and relationship details unfold individually. Disclosure resets with selection. Perspectives and
journeys themselves link between diagram types; a redundant diagram-type switcher is not part of the
shell. Architecture's Trust lens and Proposed visibility are independent switches on one compact
row above those lists in the left rail; Structure remains the Trust-off state. Personal disclosure and
sidebar-width state stay in browser storage rather than authored models or shared links. The rail is
pointer- and keyboard-resizable on desktop, with bounded responsive geometry and animated canvas
reflow. Its toggle shares the rail's right edge in the appbar. The appbar keeps a lighter text-only
wordmark and exposes clickable perspective, journey, and focused-model ancestry beside the project
selector; keyboard help sits with the permalink action instead of consuming rail space. Titles and
subtitles sit directly over the canvas instead of occupying a separate toolbar or full-width heading band.
Architecture node and container padding comes from one shared density profile used by layout, live
rendering, and export, leaving a deliberate seam for later theme-specific tuning.
Sequence rows share a baseline between a short title and subtitle, and label
text wraps to the plate the renderers draw, so an expanded journey stays close to the density of a
hand-drawn sequence chart. Participant headers share one height derived from the tallest visible
wrapped title, so short labels stay compact without allowing column geometry to drift. Top-level
phases remain quiet bands while nested phases render as underlined subheaders, and all phase and
interaction heights follow their measured text. The phase list offers one keyboard-accessible bulk
fold control. Self-return arrows share gently rounded geometry across the live canvas and exported
SVG, while sequence reload lives beside the permalink rather than in the sidebar. The sequence canvas holds its scale and position when the viewport changes
instead of re-fitting.

## Layout performance and engines

[Layout performance and pluggable layout engines](layout-performance-and-engines.md) controls
how architecture geometry is computed, benchmarked, and swapped. It keeps the current appearance
as the fingerprinted default, adds a layout benchmark CLI, and opens a layout-engine seam.

## Linked project diagrams

[Linked project diagrams on one canvas](linked-project-diagrams.md) is the proposed implementation
plan for revealing repository-owned architecture diagrams together, with explicit cross-project
connections and independent project layouts. Sidecar → td and Recall is the steel thread. It covers
identity, resolution, boundaries, performance budgets, surface parity and portable exports;
implementation has not started.

## Saved workspace idea

[Multi-diagram workspace canvas](../planning/multi-diagram-canvas.md) records an idea for
side-by-side, independently navigable architecture and sequence frames across projects. It is
future exploration, not part of the sequence prototype. Connected architecture projects are scoped
by the linked-project plan above; arbitrary frames and mixed diagram types remain in this idea.

## Sequence implementation readiness

The ordered-journey profile already has a reusable implementation: stable source IDs, optional
versioned authoring, shared projection/layout/export and thin CLI/HTTP entry points. No replacement
representation is needed to make this supported functionality. Keep the format experimental until
it has been exercised in another real project/proposal and its compatibility promise is explicit.

Branches, loops, parallel fragments and timing are separate semantic capabilities, not prerequisites
for completing the current profile. If demanded by real journeys, introduce explicit versioned step
variants; never reinterpret presentation phases as control flow. Continue refining the viewer from
actual use, with combined folding/hiding, keyboard navigation and exported artwork as acceptance
criteria. The separate spatial workspace remains saved future work.
