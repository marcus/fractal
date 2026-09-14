#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadDirectory, loadModel, listProjects, snapshotOf } from '../src/lib/server/models';
import {
  BudgetExceededError,
  composedProjectSummary,
  composeFromSelector,
  getCompositionStats,
  inspectInComposition,
  linksFor,
  linksForLocated,
  resolveCompositionStateInput,
  RevisionConflictError,
  searchInComposition,
  validateLinked,
  validateLinkedSnapshot,
  type CompositionSelector,
  type LinkedValidation
} from '../src/lib/server/composition';
import {
  ExportUnresolvedError,
  exportComposition,
  type CompositionExportFormat
} from '../src/lib/server/export';
import { SourceChangingError } from '../src/lib/server/models';
import { parseCompositionState } from '../src/lib/composition/parse';
import type { QualifiedSelection } from '../src/lib/composition/types';
import { inspectComponent } from '../src/lib/core/inspect';
import { project } from '../src/lib/core/projection';
import { showAllStructure } from '../src/lib/core/navigation';
import { layout } from '../src/lib/core/layout';
import { LAYOUT_ENGINES, getLayoutEngineInfo } from '../src/lib/core/layout-engines';
import { renderPng } from '../src/lib/adapters/png';
import { buildPortableAssets } from './portable-assets';
import { exportHtml, exportLinkedDocument, shouldExportLinkedHtml } from '../src/lib/adapters/html';
import { exportSvg } from '../src/lib/core/svg';
import { shortcutsForSurface } from '../src/lib/core/shortcuts';
import { searchModel, revealSearchResult } from '../src/lib/core/search';
import { getTheme, THEMES } from '../src/lib/core/themes';
import type { ViewState } from '../src/lib/core/types';
import { layoutSequence } from '../src/lib/sequence/layout';
import { exportSequenceSvg } from '../src/lib/sequence/svg';

async function main() {
  // The benchmark iterates many models and owns its own options, so it is dispatched before the
  // single-model path parses arguments or loads anything.
  const argv = process.argv.slice(2);
  if (argv[0] === 'bench') {
    const { runBench } = await import('./bench');
    return runBench(argv.slice(1));
  }
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      directory: { type: 'string' },
      catalog: { type: 'string' },
      scene: { type: 'string' },
      linked: { type: 'boolean' },
      composition: { type: 'string' },
      'composition-state': { type: 'string' },
      selection: { type: 'string' },
      surface: { type: 'string', default: 'architecture' },
      journey: { type: 'string' },
      'collapsed-phases': { type: 'string' },
      'collapsed-groups': { type: 'string' },
      'hidden-participants': { type: 'string' },
      'scope-phase': { type: 'string' },
      'visible-phases': { type: 'string' },
      expanded: { type: 'string' },
      'show-all': { type: 'boolean' },
      proposed: { type: 'boolean' },
      lens: { type: 'string' },
      output: { type: 'string' },
      'allow-unresolved': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      element: { type: 'string' },
      query: { type: 'string' },
      scope: { type: 'string' },
      theme: { type: 'string' },
      layout: { type: 'string' },
      format: { type: 'string', default: 'svg' },
      include: { type: 'string' }
    }
  });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    console.log(
      `Fractal · an explorable model of software\n\nUsage: npm run cli -- <command> [options]\n\nCommands:\n  service    Manage the installed local studio (bin/fractal service --help)\n  projects   List catalog projects and their resolved model metadata\n  links      List authored links and each foreign model's resolution status\n  journeys   List available sequence journeys\n  journey    Inspect one authored journey (--journey ID)\n  sequence   Lay out an explorable sequence as JSON\n  sequence-export  Export the sequence as SVG or PNG\n  validate   Compile and validate a model and its scenes (--linked for the link closure)\n  inspect    Read the normalized model, or --element ID and its relationships\n  project    Resolve a mixed-depth view with underlying relationship IDs\n  layout     Resolve vector geometry for the selected view\n  export     Write SVG, 4K PNG, or an interactive offline HTML document (--output FILE)\n  themes     List available presentation themes (use --json for tokens)\n  engines    List available layout engines (use --json for metadata)\n  bench      Time the layout pipeline and fingerprint its geometry (bin/fractal bench --help)\n  shortcuts  List keyboard commands from the shared registry\n  search     Search all components, connections and views, with resolved view state\n  composition-stats  Cache, queue and limit instrumentation (--json)\n\nOptions:\n  --model ID                     Catalog model (default delivery)\n  --catalog PATH                 Use a specific catalog.json\n  --directory PATH               Read model.c4 + fractal.json from a directory\n  --linked                       Validate the declared linked-project closure\n  --composition ID               Authored composition from the root links.json\n  --composition-state FILE|v1.… Explicit state file or encoded permalink value\n  --allow-unresolved            Export despite failed targets (unavailable cards + manifest)\n  --selection JSON               Qualified selection for inspect in a composition\n  --surface architecture|sequence|portable Shortcut surface (default architecture)\n  --journey ID                   Sequence journey identifier\n  --collapsed-phases ID,ID        Fold sequence phases\n  --collapsed-groups ID,ID        Combine participant columns\n  --hidden-participants ID,ID     Hide columns with explicit interaction summaries\n  --scope-phase ID               Focus a sequence phase\n  --visible-phases ID,ID         Show exact phases with ancestor context (empty shows none)\n  --scene ID                     Start from a saved scene\n  --expanded ID,ID                Override expanded elements (empty collapses all)\n  --show-all                     Expand all structure within the selected scope\n  --proposed                     Include proposed elements and relationships\n  --lens structure|trust         Boundary lens\n  --scope ID                     Focus one component; retain external connection inventory\n  --theme grove|graphite|midnight Presentation theme (default Grove)\n  --layout ID                    Layout engine for architecture views (see engines)\n  --json                         Structured output\n  --element ID                   Inspect a stable element ID\n  --query TEXT                   Search titles, identifiers and descriptions\n  --format svg|png|html          Export format (HTML includes the full model, or a linked set with --include; a root owning links.json exports a linked document with a root-only included set by default; PNG needs Chromium)\n  --include ID,ID                HTML export: embed these linked projects with the root\n  --output PATH                  Write result to a file\n\nExamples:\n  npm run cli -- projects --json\n  npm run cli -- links --model sidecar --json\n  npm run cli -- validate --model delivery --json\n  npm run cli -- layout --model host --composition plugins\n  npm run cli -- export --scene execution --theme midnight --output artifacts/execution.svg`
    );
    return;
  }
  if (command === 'shortcuts') {
    if (!['architecture', 'sequence', 'portable'].includes(values.surface!))
      throw new Error('Surface must be architecture, sequence or portable');
    console.log(
      JSON.stringify(
        shortcutsForSurface(values.surface as 'architecture' | 'sequence' | 'portable'),
        null,
        2
      )
    );
    return;
  }
  if (command === 'engines') {
    if (values.json) console.log(JSON.stringify(LAYOUT_ENGINES, null, 2));
    else
      console.log(
        LAYOUT_ENGINES.map(
          (engine) => `${engine.id.padEnd(18)} ${engine.title} · ${engine.description}`
        ).join('\n')
      );
    return;
  }
  if (command === 'themes') {
    if (values.json) console.log(JSON.stringify(THEMES, null, 2));
    else
      console.log(
        THEMES.map((theme) => `${theme.id.padEnd(10)} ${theme.name} · ${theme.description}`).join(
          '\n'
        )
      );
    return;
  }
  const catalogOptions = { catalog: values.catalog };
  const printResult = async (result: unknown): Promise<void> => {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (values.output) {
      await writeFile(values.output, text + '\n');
      console.log(JSON.stringify({ output: resolve(values.output) }));
    } else console.log(text);
  };
  const compositionCommands = ['project', 'layout', 'inspect', 'search', 'export'];
  const hasComposition =
    values.composition !== undefined || values['composition-state'] !== undefined;
  if (hasComposition && !compositionCommands.includes(command))
    throw new Error(
      '--composition and --composition-state are supported for project, layout, inspect, search and export'
    );
  if (command === 'composition-stats') {
    // Cache, queue, rejected-work and limit instrumentation for operators and the bench.
    await printResult(getCompositionStats());
    return;
  }
  if (command === 'links') {
    const result = values.directory
      ? await linksForLocated(await loadDirectory(resolve(values.directory)), catalogOptions)
      : await linksFor(values.model ?? 'delivery', catalogOptions);
    await printResult(result);
    return;
  }
  if (command === 'validate' && values.linked) {
    const validation = values.directory
      ? await validateLinkedSnapshot(
          snapshotOf(await loadDirectory(resolve(values.directory))),
          catalogOptions
        )
      : await validateLinked(values.model ?? 'delivery', catalogOptions);
    if (values.json) await printResult(validation);
    else if (!validation.valid) await printResult(validation.diagnostics);
    else console.log(`${validation.model}: linked closure valid`);
    if (!validation.valid) process.exitCode = 1;
    return;
  }
  if (command === 'projects') {
    const projects = await listProjects(catalogOptions);
    if (values.json) console.log(JSON.stringify(projects, null, 2));
    else
      console.log(
        projects
          .map(
            (project) =>
              `${project.id.padEnd(16)} ${project.title} · ${project.description}\n${project.directory}`
          )
          .join('\n')
      );
    return;
  }
  const compositionStateInput = values['composition-state'];
  if (
    values.composition !== undefined &&
    compositionStateInput !== undefined &&
    compositionCommands.includes(command)
  )
    throw new Error('--composition and --composition-state are mutually exclusive');
  let explicitCompositionState: ReturnType<typeof parseCompositionState> | undefined;
  if (compositionStateInput !== undefined && compositionCommands.includes(command)) {
    // A versioned `v1.` value is an encoded permalink; anything else is a state file path.
    explicitCompositionState = compositionStateInput.startsWith('v1.')
      ? resolveCompositionStateInput(compositionStateInput)
      : parseCompositionState(JSON.parse(await readFile(resolve(compositionStateInput), 'utf8')));
    if (values.model !== undefined && values.model !== explicitCompositionState.root)
      throw new Error(
        `Composition state root ${explicitCompositionState.root} does not match --model ${values.model}`
      );
  }
  const requestedModel = explicitCompositionState?.root ?? values.model ?? 'delivery';
  const loaded = values.directory
    ? await loadDirectory(resolve(values.directory))
    : await loadModel(requestedModel, catalogOptions);
  const { model, sequences } = loaded;
  if (['journeys', 'journey', 'sequence', 'sequence-export'].includes(command)) {
    let result: unknown;
    if (command === 'journeys') {
      result = sequences.map(({ id, title, description, status }) => ({
        id,
        title,
        description,
        status
      }));
      if (!values.json)
        result = sequences.length
          ? sequences
              .map(
                (item) =>
                  `${item.id.padEnd(20)} ${item.title} [${item.status}]\n${item.description}`
              )
              .join('\n')
          : 'No sequence journeys in this model';
    } else {
      const journey = values.journey
        ? sequences.find((item) => item.id === values.journey)
        : sequences[0];
      if (!journey)
        throw new Error(
          values.journey
            ? `Unknown journey: ${values.journey}`
            : 'No sequence journeys in this model'
        );
      if (command === 'journey') {
        result = values.json
          ? journey
          : `${journey.title} [${journey.status}]\n${journey.id} · ${journey.description}\n${journey.participants.length} participants · ${journey.groups.length} groups\n${journey.provenance}`;
      } else {
        const split = (value: string | undefined) => value?.split(',').filter(Boolean) ?? [];
        const diagram = layoutSequence(journey, {
          collapsedPhases: split(values['collapsed-phases']),
          collapsedGroups: split(values['collapsed-groups']),
          hiddenParticipants: split(values['hidden-participants']),
          ...(values['visible-phases'] !== undefined
            ? { visiblePhases: split(values['visible-phases']) }
            : {}),
          ...(values['scope-phase'] ? { scopePhase: values['scope-phase'] } : {}),
          theme: getTheme(values.theme).id
        });
        result = diagram;
        if (command === 'sequence-export') {
          if (!['svg', 'png'].includes(values.format!))
            throw new Error('Format must be svg or png');
          const svg = exportSequenceSvg(journey, diagram);
          if (values.format === 'png') {
            if (!values.output) throw new Error('PNG export requires --output');
            await writeFile(values.output, await renderPng(svg));
            console.log(JSON.stringify({ output: resolve(values.output), format: 'png' }));
            return;
          }
          result = svg;
        }
      }
    }
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (values.output) {
      await writeFile(values.output, text + '\n');
      console.log(JSON.stringify({ output: resolve(values.output) }));
    } else console.log(text);
    return;
  }
  if (hasComposition) {
    const root = values.directory ? snapshotOf(loaded) : requestedModel;
    if (
      values.directory &&
      explicitCompositionState &&
      loaded.model.id !== explicitCompositionState.root
    )
      throw new Error(
        `Composition state root ${explicitCompositionState.root} does not match --directory model ${loaded.model.id}`
      );
    const selector: CompositionSelector = explicitCompositionState
      ? { state: explicitCompositionState }
      : { composition: values.composition };
    if (command === 'export') {
      const format = (values.format ?? 'svg') as string;
      if (!['svg', 'png'].includes(format))
        throw new Error('Composition export format must be svg or png');
      if (format === 'png' && !values.output) throw new Error('PNG export requires --output');
      const exported = await exportComposition(root, selector, {
        ...catalogOptions,
        format: format as CompositionExportFormat,
        ...(values['allow-unresolved'] === true ? { allowUnresolved: true } : {})
      });
      const report = {
        ...exported.manifest,
        ...(values.output ? { output: resolve(values.output) } : {})
      };
      if (format === 'png') {
        await writeFile(values.output!, exported.png!);
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      if (values.output) {
        await writeFile(values.output, `${exported.svg}\n`);
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      // Artwork stays on stdout like single-model export; the manifest report follows
      // on stderr when --json asks for it.
      console.log(exported.svg);
      if (values.json) console.error(JSON.stringify(report, null, 2));
      return;
    }
    if (command === 'project') {
      const { composed } = await composeFromSelector(root, selector, catalogOptions);
      await printResult(composedProjectSummary(composed));
      return;
    }
    if (command === 'layout') {
      const { composed } = await composeFromSelector(root, selector, catalogOptions);
      await printResult(composed);
      return;
    }
    if (command === 'inspect') {
      if (values.selection === undefined)
        throw new Error('inspect with --composition requires --selection JSON');
      const selection = JSON.parse(values.selection) as QualifiedSelection;
      await printResult(await inspectInComposition(root, selector, selection, catalogOptions));
      return;
    }
    await printResult(
      await searchInComposition(root, selector, values.query ?? '', catalogOptions)
    );
    return;
  }
  const scene = values.scene ? model.scenes.find((s) => s.id === values.scene) : model.scenes[0];
  if (!scene) throw new Error(`Unknown scene: ${values.scene}`);
  if (values.lens && !['structure', 'trust'].includes(values.lens))
    throw new Error('Lens must be structure or trust');
  const theme = getTheme(values.theme ?? scene.theme);
  const engine = getLayoutEngineInfo(values.layout ?? scene.layout);
  let state: ViewState = {
    expanded:
      values.expanded !== undefined ? values.expanded.split(',').filter(Boolean) : scene.expanded,
    proposed: values.proposed ?? scene.proposed,
    lens: (values.lens as ViewState['lens']) ?? scene.lens,
    scope: values.scope ?? scene.scope,
    ...(values.theme !== undefined || scene.theme !== undefined ? { theme: theme.id } : {}),
    ...(values.layout !== undefined || scene.layout !== undefined ? { layout: engine.id } : {})
  };
  if (values['show-all']) state = showAllStructure(model, state);
  let result: unknown;
  switch (command) {
    case 'validate':
      for (const s of model.scenes) project(model, s);
      result = {
        valid: true,
        model: model.id,
        elements: model.elements.length,
        relationships: model.relationships.length,
        scenes: model.scenes.length,
        journeys: sequences.length
      };
      break;
    case 'inspect': {
      if (!values.element) result = model;
      else {
        result = inspectComponent(model, values.element, state);
      }
      break;
    }
    case 'search':
      result = searchModel(model, values.query ?? '').map((entry) => ({
        ...entry,
        ...revealSearchResult(model, state, entry)
      }));
      break;
    case 'project':
      result = project(model, state);
      break;
    case 'layout':
      result = await layout(model, state);
      break;
    case 'export': {
      if (!['svg', 'png', 'html'].includes(values.format!))
        throw new Error('Format must be svg, png or html');
      if (values.format === 'html') {
        if (!values.output) throw new Error('HTML export requires --output');
        const assets = await buildPortableAssets();
        const extras =
          values.include === undefined
            ? []
            : values.include
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean);
        if (
          shouldExportLinkedHtml(values.include === undefined ? undefined : extras, loaded.links)
        ) {
          const snapshots = [snapshotOf(loaded)];
          const sequencesByModel: Record<string, typeof sequences> = { [model.id]: sequences };
          for (const id of extras) {
            if (id === model.id) continue;
            const other = await loadModel(id, catalogOptions);
            snapshots.push(snapshotOf(other));
            sequencesByModel[id] = other.sequences;
          }
          const { html, report } = await exportLinkedDocument(model, {
            state,
            scene: scene.id,
            sequences,
            assets,
            include: extras,
            snapshots,
            sequencesByModel
          });
          await writeFile(values.output, html);
          console.log(JSON.stringify({ output: resolve(values.output), ...report }));
          return;
        }
        await writeFile(
          values.output,
          await exportHtml(model, {
            state,
            scene: scene.id,
            sequences,
            assets
          })
        );
        console.log(
          JSON.stringify({
            output: resolve(values.output),
            format: 'html',
            model: model.id,
            scene: scene.id
          })
        );
        return;
      }
      if (values.include !== undefined)
        throw new Error('--include is only supported for HTML export');
      const svg = exportSvg(model, await layout(model, state), {
        title: `${model.title} / ${scene.title}`,
        subtitle: scene.description
      });
      if (values.format === 'png') {
        if (!values.output) throw new Error('PNG export requires --output');
        await writeFile(values.output, await renderPng(svg));
        console.log(JSON.stringify({ output: resolve(values.output), format: 'png' }));
        return;
      }
      result = svg;
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  if (values.output) {
    await writeFile(values.output, text + '\n');
    console.log(JSON.stringify({ output: resolve(values.output) }));
  } else console.log(text);
}
main().catch((error) => {
  // Boundary failures carry their code and diagnostics; every other error keeps the exact
  // historical `{ error }` shape single-model callers rely on.
  if (error instanceof ExportUnresolvedError)
    console.error(
      JSON.stringify({
        error: error.message,
        code: error.code,
        diagnostics: error.diagnostics
      })
    );
  else if (error instanceof BudgetExceededError)
    console.error(
      JSON.stringify({
        error: error.message,
        code: error.code,
        diagnostics: error.diagnostics
      })
    );
  else if (error instanceof RevisionConflictError)
    console.error(
      JSON.stringify({
        error: error.message,
        code: error.code,
        model: error.model,
        expected: error.expected,
        actual: error.actual,
        recovery: error.recovery
      })
    );
  else if (error instanceof SourceChangingError)
    console.error(
      JSON.stringify({ error: error.message, code: error.code, recovery: error.recovery })
    );
  else console.error(JSON.stringify({ error: (error as Error).message }));
  process.exitCode = 1;
});
