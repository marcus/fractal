<script lang="ts">
  import { dismissBackdrop } from '$lib/ui/dismiss-backdrop';
  import { onMount, tick } from 'svelte';
  import { searchModel, type SearchResult } from '$lib/core/search';
  import { searchProjects } from '$lib/core/catalog';
  import type { Model } from '$lib/core/types';
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
  let {
    model,
    projects,
    currentProject = '',
    journeys = [],
    onsequence,
    projectsOnly = false,
    catalogError = '',
    onpick,
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
    onproject: (id: string) => void;
    onrefresh: () => void;
    onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let query = $state('');
  let active = $state(0);
  const results = $derived<(SearchResult | ProjectResult | JourneyResult)[]>([
    ...searchProjects(projects, query).map((project) => ({ ...project, type: 'project' as const })),
    ...(!projectsOnly && onsequence
      ? searchProjects(journeys, query).map((journey) => ({
          ...journey,
          type: 'sequence' as const
        }))
      : []),
    ...(!projectsOnly && model ? searchModel(model, query) : [])
  ]);
  function pick(result: SearchResult | ProjectResult | JourneyResult) {
    if (result.type === 'project') onproject(result.id);
    else if (result.type === 'sequence') onsequence?.(result.id);
    else onpick(result);
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
    {#each results as result, i (result.type + ':' + result.id)}
      <button
        id={`jump-result-${i}`}
        role="option"
        aria-selected={i === active}
        tabindex="-1"
        class:highlighted={i === active}
        onclick={() => pick(result)}
      >
        <span class="result-symbol" aria-hidden="true"
          >{#if result.type === 'scene' || result.type === 'project' || result.type === 'sequence'}<Grid
              size={18}
            />{:else if result.type === 'relationship'}<Link size={18} />{:else}<ArrowUpRight
              size={18}
            />{/if}</span
        >
        <span class="result-copy"
          ><strong>{result.title}</strong><small>{result.description}</small></span
        >
        <span class="result-type"
          >{result.status === 'proposed' ? 'Proposed · ' : ''}{result.type === 'project'
            ? result.id === currentProject
              ? 'Current project'
              : 'Project'
            : result.type === 'sequence'
              ? 'Sequence'
              : result.type === 'scene'
                ? 'View'
                : result.type === 'relationship'
                  ? 'Connection'
                  : 'Component'}</span
        >
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
