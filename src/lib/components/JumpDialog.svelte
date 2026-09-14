<script lang="ts">
  import { dismissBackdrop } from '$lib/ui/dismiss-backdrop';
  import { onMount, tick } from 'svelte';
  import { searchModel, type SearchResult } from '$lib/core/search';
  import { searchProjects } from '$lib/core/catalog';
  import type { Model } from '$lib/core/types';
  import type { CompositionSearchResult } from '$lib/composition/search';
  import { Grid, ArrowUpRight, Link } from '@marcusv/roc/svelte/outline';
  type ProjectResult = {
    id: string;
    type: 'project';
    title: string;
    description: string;
    status?: undefined;
  };
  type JourneyResult = Omit<ProjectResult, 'type' | 'status'> & {
    type: 'sequence';
    status: 'current' | 'proposed';
  };
  type CompositionHit = CompositionSearchResult & { type: 'composition' };
  let {
    model,
    projects,
    currentProject = '',
    journeys = [],
    onsequence,
    projectsOnly = false,
    catalogError = '',
    onpick,
    oncomposition,
    compositionSearch = undefined,
    projectTitle = undefined,
    onproject,
    onrefresh,
    onclose
  }: {
    model: Model | null;
    projects: { id: string; title: string; description: string }[];
    /** The open project. The switcher starts on it, so Enter and Escape both leave you here. */
    currentProject?: string;
    journeys?: { id: string; title: string; description: string; status: 'current' | 'proposed' }[];
    onsequence?: (id: string) => void;
    projectsOnly?: boolean;
    catalogError?: string;
    onpick: (result: SearchResult) => void;
    oncomposition?: (result: CompositionSearchResult) => void;
    compositionSearch?: (query: string) => CompositionSearchResult[];
    projectTitle?: (model: string) => string;
    onproject: (id: string) => void;
    onrefresh: () => void;
    onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let query = $state('');
  let active = $state(0);
  const results = $derived<(SearchResult | ProjectResult | JourneyResult | CompositionHit)[]>([
    ...searchProjects(projects, query).map((project) => ({ ...project, type: 'project' as const })),
    ...(!projectsOnly && onsequence
      ? searchProjects(journeys, query).map((journey) => ({
          ...journey,
          type: 'sequence' as const
        }))
      : []),
    ...(!projectsOnly && compositionSearch
      ? compositionSearch(query).map((result) => ({ ...result, type: 'composition' as const }))
      : !projectsOnly && model
        ? searchModel(model, query)
        : [])
  ]);
  function pick(result: SearchResult | ProjectResult | JourneyResult | CompositionHit) {
    if (result.type === 'project') onproject(result.id);
    else if (result.type === 'sequence') onsequence?.(result.id);
    else if (result.type === 'composition') oncomposition?.(result);
    else onpick(result);
  }
  function resultKey(result: SearchResult | ProjectResult | JourneyResult | CompositionHit) {
    if (result.type === 'composition')
      return `composition:${result.model}:${result.kind}:${result.id}`;
    return `${result.type}:${result.id}`;
  }
  function resultHeading(result: SearchResult | ProjectResult | JourneyResult | CompositionHit) {
    if (result.type === 'composition' && result.kind === 'link') return `Open ${result.title}`;
    return result.title;
  }
  function resultDetail(result: SearchResult | ProjectResult | JourneyResult | CompositionHit) {
    if (result.type !== 'composition') return result.description;
    const project = projectTitle?.(result.model) ?? result.model;
    return `${project} · ${result.description}`;
  }
  function resultKindLabel(result: SearchResult | ProjectResult | JourneyResult | CompositionHit) {
    const proposed = result.status === 'proposed' ? 'Proposed · ' : '';
    if (result.type === 'composition') {
      if (result.kind === 'link') return 'Open linked';
      if (result.kind === 'scene') return `${proposed}View`;
      if (result.kind === 'relationship') return `${proposed}Connection`;
      if (result.kind === 'boundary') return 'Boundary';
      return `${proposed}Component`;
    }
    if (result.type === 'project')
      return result.id === currentProject ? 'Current project' : 'Project';
    if (result.type === 'sequence') return `${proposed}Sequence`;
    if (result.type === 'scene') return 'View';
    if (result.type === 'relationship') return `${proposed}Connection`;
    return `${proposed}Component`;
  }
  function resultIcon(result: SearchResult | ProjectResult | JourneyResult | CompositionHit) {
    if (result.type === 'composition') {
      if (result.kind === 'link' || result.kind === 'scene') return 'grid';
      if (result.kind === 'relationship') return 'link';
      return 'arrow';
    }
    if (result.type === 'scene' || result.type === 'project' || result.type === 'sequence')
      return 'grid';
    if (result.type === 'relationship') return 'link';
    return 'arrow';
  }
  onMount(() => {
    dialog.showModal();
    input.focus();
    // Start the switcher on the project the reader is already in rather than the first name.
    if (projectsOnly) {
      const index = results.findIndex((r) => r.type === 'project' && r.id === currentProject);
      if (index > 0) {
        active = index;
        tick().then(() =>
          dialog.querySelector(`#jump-result-${index}`)?.scrollIntoView({ block: 'nearest' })
        );
      }
    }
    return () => dialog.close();
  });
  async function move(delta: number) {
    active = results.length ? (active + delta + results.length) % results.length : 0;
    await tick();
    dialog.querySelector(`#jump-result-${active}`)?.scrollIntoView({ block: 'nearest' });
  }
  function keydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (results[active]) pick(results[active]);
    }
  }
</script>

<dialog
  bind:this={dialog}
  use:dismissBackdrop={onclose}
  class="navigation-dialog jump-dialog"
  aria-label={projectsOnly ? 'Switch project' : 'Jump to'}
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  <input
    bind:this={input}
    bind:value={query}
    oninput={() => (active = 0)}
    onkeydown={keydown}
    role="combobox"
    aria-label={projectsOnly
      ? 'Search projects'
      : 'Search projects, components, connections, views and sequences'}
    aria-expanded="true"
    aria-controls="jump-results"
    aria-activedescendant={results[active] ? `jump-result-${active}` : undefined}
    aria-autocomplete="list"
    placeholder={projectsOnly
      ? 'Find a project…'
      : 'Find a project, component, connection, view, or sequence…'}
    autocomplete="off"
    spellcheck="false"
  />
  {#if catalogError}<p class="catalog-error" role="alert">{catalogError}</p>{/if}
  <div class="jump-results" id="jump-results" role="listbox" aria-label="Search results">
    {#each results as result, i (resultKey(result))}
      <button
        id={`jump-result-${i}`}
        role="option"
        aria-selected={i === active}
        tabindex="-1"
        class:highlighted={i === active}
        data-jump-kind={result.type === 'composition' ? result.kind : result.type}
        data-jump-model={result.type === 'composition' ? result.model : undefined}
        onclick={() => pick(result)}
      >
        <span class="result-symbol" aria-hidden="true"
          >{#if resultIcon(result) === 'grid'}<Grid
              size={18}
            />{:else if resultIcon(result) === 'link'}<Link size={18} />{:else}<ArrowUpRight
              size={18}
            />{/if}</span
        >
        <span class="result-copy"
          ><strong>{resultHeading(result)}</strong><small>{resultDetail(result)}</small></span
        >
        <span class="result-type">{resultKindLabel(result)}</span>
      </button>
    {:else}<p class="jump-empty">
        {projectsOnly && !projects.length
          ? 'No projects in this catalog yet. Add a project to your Fractal catalog, then refresh.'
          : 'No matches. Try a project, component, connection, sequence, or identifier.'}
      </p>{/each}
  </div>
  <footer>
    {#if projectsOnly}<button class="button" onclick={onrefresh}>Refresh projects</button>{/if}
    <span><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> jump <kbd>esc</kbd> close</span><span
      >{results.length} results</span
    >
  </footer>
</dialog>
