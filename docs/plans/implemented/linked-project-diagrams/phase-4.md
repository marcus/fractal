# Linked diagrams: phase 4 evidence

Status: complete, 2026-09-14. Epic: `td-93c60e`. Tasks: export core and CLI `td-af1618`,
portable HTML `td-a39cf6`, studio export options `td-07dfd9`. The
[controlling plan](../linked-project-diagrams.md) defines acceptance.

## What shipped

- **Composed SVG and PNG.** `exportCompositionSvg` renders every frame, local diagram, port, stub
  card and bridge with namespaced ids, markers and clip paths, independent of viewport culling;
  PNG through the existing renderer; a manifest with included projects and revisions, composition
  state, omitted links and unresolved diagnostics; unresolved participating targets fail by
  default, `--allow-unresolved` renders unavailable cards; `fractal export --composition |
--composition-state` and `/api/export` with the manifest in the `x-fractal-export-manifest`
  header; malformed selectors are refused with 400; single-model export is byte-identical.
- **Portable HTML.** An explicit included set (`--include`, HTTP `include`), defaulting to the
  root only for a root that owns `links.json`; embedded models, scenes, evidence, link manifests,
  identity origins and a versioned revision manifest; an offline reader that runs the composition
  core over a static resolver with the existing layout worker; excluded and unavailable links stay
  honest placeholders and never fetch; linked documents advertise contract v1 and omit the
  single-model fields so an older reader cannot present the root as a complete composition.
- **Studio export dialog.** Composition SVG/PNG/HTML with the included-set choice, scope report
  from the server manifest, the unavailable-cards option on 422, and a proof across Grove,
  Graphite and Midnight. Proposed bridges use the proposed colour on the canvas and in exports.

## Evidence

| Outcome                                                  | Evidence                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Namespacing, offscreen content, omission cards, manifest | `tests/composition-export.test.ts`, `tests/composition-export-route.test.ts`                                  |
| Included set, embedded manifests, offline reader         | `tests/portable-linked.test.ts`, the offline spec in `tests/browser.spec.ts`                                  |
| Dialog and all-themes artwork                            | the export spec in `tests/browser.spec.ts`; local artwork under `artifacts/linked-project-phase4/`            |
| Real steel thread export (Sidecar + td + Recall)         | recorded on `td-7ecb7a`: SVG with 3 frames, 2 bridges, no duplicate ids; PNG; HTML with `--include td,recall` |

Reviews found and fixed a silently dropped malformed selector, a single-model HTML fallback for
roots that own links, a route/CLI parity gap for `include`, and a letterboxed dialog PNG
(`td-8e7d76`, fixed with the final-review batch).
