#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadDirectory, loadModel, listProjects } from '../src/lib/server/models';
import { inspectComponent } from '../src/lib/core/inspect';
import { project } from '../src/lib/core/projection';
import { showAllStructure } from '../src/lib/core/navigation';
import { layout } from '../src/lib/adapters/elk-layout';
import { renderPng } from '../src/lib/adapters/png';
import { exportSvg } from '../src/lib/core/svg';
import { shortcutsForSurface } from '../src/lib/core/shortcuts';
import { searchModel, revealSearchResult } from '../src/lib/core/search';
import { getTheme, THEMES } from '../src/lib/core/themes';
import type { ViewState } from '../src/lib/core/types';
import { layoutSequence } from '../src/lib/sequence/layout';
import { exportSequenceSvg } from '../src/lib/sequence/svg';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string', default: 'delivery' },
      directory: { type: 'string' },
      catalog: { type: 'string' },
      scene: { type: 'string' },
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
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      element: { type: 'string' },
      query: { type: 'string' },
      scope: { type: 'string' },
      theme: { type: 'string' },
      format: { type: 'string', default: 'svg' }
    }
  });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    console.log(
      `Fractal · an explorable model of software\n\nUsage: npm run cli -- <command> [options]\n\nCommands:\n  service    Manage the installed local studio (bin/fractal service --help)\n  projects   List catalog projects and their resolved model metadata\n  journeys   List available sequence journeys\n  journey    Inspect one authored journey (--journey ID)\n  sequence   Lay out an explorable sequence as JSON\n  sequence-export  Export the sequence as SVG or PNG\n  validate   Compile and validate a model and its scenes\n  inspect    Read the normalized model, or --element ID and its relationships\n  project    Resolve a mixed-depth view with underlying relationship IDs\n  layout     Resolve vector geometry for the selected view\n  export     Write a self-contained 16:9 SVG or 4K PNG (--output FILE)\n  themes     List available presentation themes (use --json for tokens)\n  shortcuts  List keyboard commands from the shared registry\n  search     Search all components, connections and views, with resolved view state\n\nOptions:\n  --model ID                     Catalog model (default delivery)\n  --catalog PATH                 Use a specific catalog.json\n  --directory PATH               Read model.c4 + fractal.json from a directory\n  --surface architecture|sequence Shortcut surface (default architecture)\n  --journey ID                   Sequence journey identifier\n  --collapsed-phases ID,ID        Fold sequence phases\n  --collapsed-groups ID,ID        Combine participant columns\n  --hidden-participants ID,ID     Hide columns with explicit interaction summaries\n  --scope-phase ID               Focus a sequence phase\n  --visible-phases ID,ID         Show exact phases with ancestor context (empty shows none)\n  --scene ID                     Start from a saved scene\n  --expanded ID,ID                Override expanded elements (empty collapses all)\n  --show-all                     Expand all structure within the selected scope\n  --proposed                     Include proposed elements and relationships\n  --lens structure|trust         Boundary lens\n  --scope ID                     Focus one component; retain external connection inventory\n  --theme grove|graphite|midnight Presentation theme (default Grove)\n  --json                         Structured output\n  --element ID                   Inspect a stable element ID\n  --query TEXT                   Search titles, identifiers and descriptions\n  --format svg|png               Export format (PNG needs Playwright Chromium)\n  --output PATH                  Write result to a file\n\nExamples:\n  npm run cli -- projects --json\n  npm run cli -- validate --model delivery --json\n  npm run cli -- export --scene execution --theme midnight --output artifacts/execution.svg`
    );
    return;
  }
  if (command === 'shortcuts') {
    if (!['architecture', 'sequence'].includes(values.surface!))
      throw new Error('Surface must be architecture or sequence');
    console.log(
      JSON.stringify(shortcutsForSurface(values.surface as 'architecture' | 'sequence'), null, 2)
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
  const { model, sequences } = values.directory
    ? await loadDirectory(resolve(values.directory))
    : await loadModel(values.model!, catalogOptions);
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
  const scene = values.scene ? model.scenes.find((s) => s.id === values.scene) : model.scenes[0];
  if (!scene) throw new Error(`Unknown scene: ${values.scene}`);
  if (values.lens && !['structure', 'trust'].includes(values.lens))
    throw new Error('Lens must be structure or trust');
  const theme = getTheme(values.theme ?? scene.theme);
  let state: ViewState = {
    expanded:
      values.expanded !== undefined ? values.expanded.split(',').filter(Boolean) : scene.expanded,
    proposed: values.proposed ?? scene.proposed,
    lens: (values.lens as ViewState['lens']) ?? scene.lens,
    scope: values.scope ?? scene.scope,
    ...(values.theme !== undefined || scene.theme !== undefined ? { theme: theme.id } : {})
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
      if (!['svg', 'png'].includes(values.format!)) throw new Error('Format must be svg or png');
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
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
