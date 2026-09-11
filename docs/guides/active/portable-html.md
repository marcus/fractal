# Portable interactive documents

Export a project-owned Fractal model as one HTML file, then open it directly or upload it to any static host:

```sh
bin/fractal export --directory /path/to/project/docs/diagrams/fractal \
  --scene overview --format html --output /path/to/artifacts/architecture.html
```

The command prints JSON containing `output`, `format`, `model`, and `scene`. It requires `--output` and accepts the same scene, theme, scope, expansion, proposal, and boundary-lens flags as SVG exports. The selected scene is the starting perspective. The studio's Export dialog offers the same **Interactive HTML** download; its API is `POST /api/export` with `format: "html"`, `model`, `state`, optional `scene`, and optional `revision`.

The file contains the full normalized model, all perspectives, optional sequence journeys, the reader, layout engine, styles, fonts, and reader license notices. It works offline through `file://` and at arbitrary nested HTTP paths. It makes no requests for assets or layout. Recipients need a modern browser with JavaScript enabled; no Fractal installation is needed.

Use **Explore** to change perspective, find a component, expand or collapse structure, inspect provenance, or open a sequence. Click a component or connection for the same evidence and technical details shown by the studio. The reader also supports pan, zoom, explicit zoom buttons for touch screens, theme changes, phase and participant-group folding, and SVG download of the current view. `?` opens keyboard help; `bin/fractal shortcuts --surface portable --json` exposes its command registry.

**Copy link** carries perspective, expansion, scope, theme, selection, and sequence state in the URL fragment. A hosted link reopens that view at the same document URL. A `file://` link is useful on the same machine; send the HTML file itself to another reader or host it first. Camera position and inspector panel preferences remain local presentation state.

To update a shared document, edit and validate its project-owned model, export again, and replace the file at the existing hosting URL. Keep scene and element IDs stable so existing view links continue to resolve. Hosting, authentication, random URL allocation, and revision history belong to the publisher; Fractal writes the portable artifact without requiring a particular service.

A perspective is not a publication filter. Hidden components, proposals, sequences, and authored evidence strings travel with the full model and remain inspectable. Review the source model before sharing. The exporter does not add the catalog, absolute model directory, or source-file contents. Authored evidence and descriptions are preserved verbatim, so any absolute path or confidential text authored there is still part of the document. Reader code is Apache 2.0 with the bundled dependencies' licenses; those licenses do not change the ownership or license of the authored architecture model.

## Maintaining the export

The portable reader reuses `DiagramCanvas`, `SequenceCanvas`, inspectors, themes, navigation, projection, and layout from the studio. `src/lib/portable/Viewer.svelte` is the browser shell, `src/lib/portable/document.ts` owns safe embedding, and `src/lib/adapters/html.ts` assembles the artifact. `scripts/portable-assets.ts` bundles the shared reader without a runtime server or CDN.

`npm run build` generates `build/portable.json` alongside the production server. Service installation copies it with the build, so the installed studio exports HTML without source files or development dependencies. `npm run dev` prepares the reader bundle before starting; rerun `npm run build:portable` after changing reader components during a development server session. CLI exports always build the current checkout's reader.

`npm test` includes an offline Chromium journey covering expansion, evidence, script-tag injection, theme and hash restoration, sequences, nested hosting, and mobile controls. Install Playwright Chromium if it is unavailable (`npx playwright install chromium`).
