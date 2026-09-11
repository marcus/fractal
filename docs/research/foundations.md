# Modeling and presentation research

Fractal separates model meaning, view selection and composition. An open standard is a
long-term direction; the prototype format remains explicitly experimental.

## Candidates

- [LikeC4](https://likec4.dev/dsl/specification/) supports custom element and relationship
  kinds, hierarchy, tags and metadata. Its [views](https://likec4.dev/dsl/views/) and
  [dynamic views](https://likec4.dev/dsl/views/dynamic/) are useful precedents. Prefer its
  official parser/API over implementing a partial grammar.
- [Structurizr](https://docs.structurizr.com/dsl) establishes one model and many C4 views.
  Strong interoperability candidate; its C4 structure is less flexible for our initial
  arbitrary nesting experiment.
- [Mermaid](https://mermaid.js.org/syntax/c4.html) is an accessible diagram notation;
  its C4 syntax is experimental. Useful future export, not the current model authority.
- [ELK](https://github.com/kieler/elkjs) supports compound layout and explicit ports.
  Layout correctness is separate from animation and must be measured on actual scenes.

## Interaction hypotheses to test

Expanding in place should show children emerging from their parent while stable elements
move only as required. It should be possible to expand neighboring subsystems independently.
A selected relationship should reveal exactly what is hidden by aggregation.

Containment forms a navigation hierarchy. Permission/network/deployment boundaries can overlap;
render membership as a lens with explicit membership details instead of claiming every group
is a structural container. A bounding envelope can be misleading if it encloses nonmembers,
so exact member highlights are required.

Presentation exports should contain the same graph, colors, wrapping and relationship routing
as exploration, with an editorial frame and no editor controls. SVG is the scalable portable
artifact; PNG supports tools that cannot consume SVG. Motion should be finite, interruptible,
and disabled for reduced-motion preferences.

## Keeping models current

The source is authored, not inferred truth. Link elements to files/contracts and record the
revision or document used. Broken links and changes since verification are future review signals,
not automatic claims that the model is accurate. A repo change and its model update can be
reviewed together. No code-scanning requirement in the first prototype.

## Prototype findings

The LikeC4 1.59.3 API was exercised, not inferred from examples. `computedModel()` is async,
collections are iterators, descriptions are RichText, and `fractalColor` avoids the language's
reserved `color` keyword. LikeC4 is MIT-licensed; it remains isolated behind one adapter.

ELK's compound graph mode accepts cross-hierarchy edges but ignores individual nested direction
choices. Its model-order heuristic also failed on the nested sample; omitting that optional
heuristic preserved deterministic, valid geometry. Narrower cards and wrapped connection labels
helped, but deep whole-system views still become very wide.

Scoped perspectives provide a useful first answer: show the selected subsystem at readable scale,
retain external relationships in a separate exact inventory, and label the focus in exported
artwork. This is an additional perspective, not a rewrite of containment. A future layout spike
should test explicit composition constraints and routing quality against the current fixtures.

Export headings, legends and footer descriptions have bounded fitting. Long visual labels use
ellipses while the model and SVG accessible metadata retain the complete authored description.
The initial canvas uses finite interpolation of node geometry and resampled connection paths.
