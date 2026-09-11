---
name: fractal
description: Author, update, validate, present, and export Fractal software models. Use for project-owned model.c4 and fractal.json files, architecture or proposal diagrams, saved perspectives, and opening a Fractal model for review; do not use it to change Fractal's core application.
---

# Fractal

Use Fractal as a presentation and inspection tool for architecture claims. Keep each model with
the project it describes. Do not copy client or private project data into Fractal's `examples/`,
and do not edit Fractal core while completing a model or diagram request.

Set the installation path once in shell examples:

```sh
FRACTAL_ROOT=/absolute/path/to/fractal
MODEL_DIR=/absolute/path/to/project/docs/diagrams/fractal
```

## Establish the claims

Author from material the user supplied and from repository evidence you actually inspected.
Preserve the distinction between:

- current behavior supported by the cited evidence;
- proposed behavior, marked `#proposed` in LikeC4 and shown only in proposed views;
- interpretation or uncertainty, stated plainly in descriptions or top-level `provenance`.

Do not present a code-layout inference as verified architecture. Evidence entries are pointers,
not proof that Fractal checked the source or that the claim is still current. Keep evidence paths
relative to the modeled project when practical. Verify each cited path exists in that checkout
and supports the associated claim; do not infer evidence filenames from class or feature names.
Ask for missing product meaning when it would
materially change the model; ordinary wording and composition choices do not require approval.

## Author the project-owned model

A model directory may also contain optional `sequences.json` for ordered journeys; see the
[sequence guide](../../docs/guides/active/sequences.md). Keep stable participant/message/phase IDs,
reference architecture element IDs, and validate all three files together. Do not approximate
unsupported concurrency or alternatives with presentation phases.

A model directory contains `model.c4` for elements, hierarchy, relationships, status, and evidence,
plus `fractal.json` for provenance, overlapping boundaries, and saved scenes. Start from the
[model format guide](../../docs/guides/active/model-format.md) and use the bundled examples only as
references. Keep explicit stable `uid` metadata for every element and relationship used by a scene,
boundary, evidence workflow, or durable link.

Prefer several purposeful scenes over one crowded graph. A useful set usually includes a concise
current overview, a focused current journey, a trust or ownership view when boundaries matter, and
a proposal scene with `proposed: true` when planned work exists. Scene titles and descriptions are
presentation copy, so write them for the audience rather than as implementation labels.

Scenes may set `"theme": "grove"`, `"graphite"`, or `"midnight"`. Omit it for the default Grove
appearance. Use `"$FRACTAL_ROOT/bin/fractal" themes --json` to inspect the shipped choices rather
than copying palette values into a project model.

## Deepen an existing model

For a drilldown request, follow the implemented responsibilities and collaboration paths behind
existing elements. Add children where they explain a useful distinction in behavior, authority,
storage or an adapter seam. A leaf can remain a leaf when another level would only restate its
description. Model responsibilities rather than reproducing every file, class or method; do not
force an existing hierarchy into nominal C4 levels.

Trace the composition root or active caller before describing a class as part of the current
runtime path. Code can exist as an unused adapter. When adding children, recheck inherited
boundary membership so host-side orchestration does not acquire a worker's execution authority.

Preserve existing identities and overview compositions. Expansion should reveal connected detail,
including meaningful links across component boundaries, without making a new scene necessary for
every expandable element. Keep scenes for purposeful walkthroughs. Explain shared dependencies
without inventing duplicate owned stores or services under each consumer.

Check both focused detail and its surrounding expanded context. Validation alone cannot catch
isolated children, misleading rolled-up links or unreadable compositions. Inspect representative
drilldowns in the viewer and export; record the source coverage and any intentionally shallow or
uncertain areas so the reader can distinguish useful coverage from an exhaustive system model.

## Validate and inspect

Run commands from any directory through the repository wrapper:

```sh
"$FRACTAL_ROOT/bin/fractal" validate --directory "$MODEL_DIR" --json
"$FRACTAL_ROOT/bin/fractal" inspect --directory "$MODEL_DIR" --json
"$FRACTAL_ROOT/bin/fractal" search --directory "$MODEL_DIR" --query "COMPONENT_OR_CONNECTION" --json
"$FRACTAL_ROOT/bin/fractal" shortcuts --json
"$FRACTAL_ROOT/bin/fractal" inspect --directory "$MODEL_DIR" --element ELEMENT_ID --json
"$FRACTAL_ROOT/bin/fractal" inspect --directory "$MODEL_DIR" --element PROPOSED_ID --proposed --json
"$FRACTAL_ROOT/bin/fractal" project --directory "$MODEL_DIR" --scene SCENE_ID --json
"$FRACTAL_ROOT/bin/fractal" project --directory "$MODEL_DIR" --scope ELEMENT_ID --show-all --json
"$FRACTAL_ROOT/bin/fractal" layout --directory "$MODEL_DIR" --scene SCENE_ID --json
```

Search returns matching elements, relationships and scenes with resolved view state and selection.
It includes hidden and proposed content; use the returned `view` when constructing a jump link.
`shortcuts --json` reports the current shared keyboard registry. In the studio, Cmd/Ctrl+K opens
jump search and ? opens the shortcut sheet. Prefer these discoverable surfaces over memorized keys.

Validation must pass after every model edit. Inspect representative current and proposed elements,
using `--proposed` when inspecting planned components so their eligible relationships are included,
then check the projected relationships and layout for each deliverable scene. Treat missing or
unexpected rolled-up connections as a modeling issue, even when the files compile.

## Export and review the rendered result

Export SVG for scalable proposal documents and slide tools that accept vector artwork. Export PNG
when the exact 3840 x 2160 appearance should be frozen:

```sh
"$FRACTAL_ROOT/bin/fractal" export --directory "$MODEL_DIR" --scene SCENE_ID \
  --theme graphite --output /absolute/path/to/project/artifacts/SCENE_ID.svg
"$FRACTAL_ROOT/bin/fractal" export --directory "$MODEL_DIR" --scene SCENE_ID \
  --theme midnight --format png --output /absolute/path/to/project/artifacts/SCENE_ID.png
```

Keep exports with the modeled project or in a temporary review directory. Open and visually inspect
the actual export before handoff: check title and subtitle, current/proposed labeling, clipped or
tiny text, node containment, crossings, spacing, and the story's reading order. Revise the model or
scene when the result is not presentation-ready, then export and inspect again. PNG export requires
Playwright Chromium; install it from the Fractal repository only if it is missing.

## Register and open an interactive model

Use the existing local studio when available. First inspect its status and catalog:

```sh
"$FRACTAL_ROOT/bin/fractal" service status --json
"$FRACTAL_ROOT/bin/fractal" projects --json
```

The default catalog is `~/.config/fractal/catalog.json` (or
`$XDG_CONFIG_HOME/fractal/catalog.json`). `--catalog PATH` overrides `FRACTAL_CATALOG`; a configured
`FRACTAL_MODELS_DIR` legacy root takes precedence over the default file. The installed service may
pin a catalog explicitly; use the catalog shown by its status when registering a model for it.
Catalog entries reference repositories without copying their models:

```json
{
  "version": 1,
  "projects": [
    {
      "id": "product",
      "directory": "/absolute/path/to/project/docs/diagrams/fractal"
    }
  ]
}
```

The entry ID must equal `fractal.json`'s ID. Keep it stable when moving a repository; update only the
absolute directory. Inspect an existing catalog before editing, preserve other entries, and avoid
duplicate IDs. Write the complete updated JSON to a sibling temporary file, then rename it over
the destination. If another tool generates the catalog, update that producer's source instead of overwriting
its output. Fractal does not require or integrate with any catalog producer.
Validate registration with `projects --catalog /absolute/path/to/catalog.json --json` and validate
the selected model with `validate --model product --catalog /absolute/path/to/catalog.json --json`.

Open the studio URL reported by service status, typically:

```text
http://127.0.0.1:5199/?model=product&scene=overview
```

When the reader is on another machine, prefer a tailnet URL from `status --json` (`tailscale.exposures`),
such as `https://<host>.<tailnet>.ts.net:5199/?model=product&scene=overview`. If none is listed,
`"$FRACTAL_ROOT/bin/fractal" service expose --json` adds one.

Use the environment's normal browser-opening facility; `open_in_codex` can show it in Codex when
available. The project switcher and Cmd/Ctrl+K find registered projects; Cmd/Ctrl+Shift+K opens
project search. Reopening either search refreshes the catalog. After editing a selected model,
use **Model source → Reload model**, or reload the page. Source files are read from the owning
repository without rebuilding or restarting Fractal. Report the URL and model directory.

For a customized durable view, URL-encode the complete view JSON along with the model ID and,
where applicable, scene ID. A scene selects its authored view; an explicit view overrides its
configuration. Read `shortcuts --json` for presentation and navigation controls.

For an unregistered model or alternate worktree, validate/export using `--directory`. For an
interactive preview, create a temporary catalog pointing to that directory and use a separate,
unused loopback port from the Fractal root:

```sh
FRACTAL_CATALOG=/absolute/path/to/temporary-catalog.json \
  npm run dev -- --host 127.0.0.1 --port 5277 --strictPort
```

Keep that process available during review and do not stop another process to claim its port.
Ordinary model updates must not change Fractal core or reinstall the studio. Installation and
application upgrades are documented in the [local service guide](../../docs/guides/active/local-service.md).
Use `bin/fractal --help` and `bin/fractal service --help` for the checked-out command contract;
never claim a capability based only on a plan or pending change.

## Sequence journeys

For a sequence request, read the [sequence guide](../../docs/guides/active/sequences.md), then author
`sequences.json` in the same project-owned directory. Use `journeys --json` to discover scenarios,
`journey --journey ID --json` to inspect one, and `sequence --journey ID --json` for its geometry.
These commands accept the same `--directory`, `--model` and `--catalog` choices.

`--collapsed-phases`, `--collapsed-groups`, `--hidden-participants`, `--visible-phases` and `--scope-phase` express the
projection without UI interaction. `sequence-export` accepts those flags plus `--theme`,
`--format svg|png` and `--output`. Open `/sequence?model=PROJECT_ID&journey=JOURNEY_ID` on the existing
studio. Preserve an explicit `seq` URL value when sharing a customized view. Inspect the actual
export and its omission summaries before including it in a proposal or slide.

The experimental profile supports authored ordered messages and nested presentation phases.
Do not claim full UML, measured timing, parallel execution, loops, or trace import. Use a separate
journey for another scenario; keep proposed journeys visibly distinct from implemented behavior.
