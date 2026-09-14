<script lang="ts">
  import { floatingPanel, panelResizer } from '$lib/ui/floating-panel';
  import { onMount, type Snippet } from 'svelte';
  import { SHORTCUTS, shortcutLabel } from '$lib/core/shortcuts';
  import { tip } from '$lib/ui/tooltip.svelte';
  import {
    Search,
    Code,
    Plus,
    Minus,
    ChevronDown,
    Grid,
    Route,
    X
  } from '@marcusv/roc/svelte/outline';
  import { architectureLink, sequenceLink } from '$lib/core/links';
  import {
    navigationSectionExpandedPreference,
    rememberNavigationSectionExpanded,
    rememberSidebarWidth,
    sidebarWidthPreference,
    panelHeightPreference,
    rememberPanelHeight,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_MIN_WIDTH,
    type NavigationSection
  } from '$lib/ui/preferences';
  import type { Model, LayoutNode, ThemeId } from '$lib/core/types';

  type Journey = { id: string; title: string; status: 'current' | 'proposed' };
  type StructureProject = {
    id: string;
    title: string;
    model: Model;
    tree: LayoutNode[];
    selected: string | null;
    expanded: string[];
    allShown: boolean;
  };
  let {
    surface = 'architecture',
    model,
    modelId,
    theme,
    journeys,
    journeyId = null,
    sceneId,
    selected = null,
    expanded = [],
    menuOpen,
    sidebarCollapsed,
    tree = [],
    chooseScene,
    chooseJourney,
    toggle,
    onshowall,
    allShown = false,
    selectInOutline,
    clearPeek,
    requestPeek,
    onjump,
    onhide,
    onsource,
    lens,
    proposed = false,
    onlens,
    onproposed,
    sourceLabel = '.c4',
    sections,
    structureProjects,
    ontogglestructure,
    onshowallstructure,
    onselectstructure
  }: {
    /** Which diagram surface the sidebar is navigating; both share the same chrome. */
    surface?: 'architecture' | 'sequence';
    model: Model | null;
    modelId: string;
    theme?: ThemeId;
    journeys: Journey[];
    journeyId?: string | null;
    sceneId: string | null;
    selected?: string | null;
    expanded?: string[];
    menuOpen: boolean;
    sidebarCollapsed: boolean;
    tree?: LayoutNode[];
    chooseScene?: (id: string) => void;
    chooseJourney?: (id: string) => void;
    toggle?: (id: string) => void;
    onshowall?: () => void;
    allShown?: boolean;
    selectInOutline?: (id: string) => void;
    clearPeek?: () => unknown;
    requestPeek?: (id: string, box: DOMRect) => void;
    onjump: () => void;
    onhide?: () => void;
    onsource: () => void;
    lens?: 'structure' | 'trust';
    proposed?: boolean;
    onlens?: (lens: 'structure' | 'trust') => void;
    onproposed?: (proposed: boolean) => void;
    sourceLabel?: string;
    /** Surface-specific navigation, shown where the architecture outline sits. */
    sections?: Snippet;
    /** Qualified outlines for every open project in a linked composition. */
    structureProjects?: StructureProject[];
    ontogglestructure?: (model: string, id: string) => void;
    onshowallstructure?: () => void;
    onselectstructure?: (model: string, id: string) => void;
  } = $props();
  let mac = $state(false);
  let sidebarElement: HTMLElement;
  /** Folded up to its title, Mac OS 9 style, by a double-click on the grip. Session chrome. */
  let shaded = $state(false);
  let sidebarWidth = $state(218);
  let resizeStart: { pointerId: number; x: number; width: number } | null = null;
  let resizeTimer: ReturnType<typeof setTimeout>;
  let perspectivesExpanded = $state(true);
  let sequencesExpanded = $state(true);
  const outlines = $derived(
    structureProjects ??
      (model
        ? [
            {
              id: modelId,
              title: model.title,
              model,
              tree,
              selected,
              expanded,
              allShown
            }
          ]
        : [])
  );
  const structureCount = $derived(
    outlines.reduce((total, project) => total + project.tree.length, 0)
  );
  const everyStructureShown = $derived(outlines.every((project) => project.allShown));

  function toggleStructure(project: StructureProject, id: string) {
    clearPeek?.();
    if (structureProjects) ontogglestructure?.(project.id, id);
    else toggle?.(id);
  }
  function selectStructure(project: StructureProject, id: string) {
    if (structureProjects) onselectstructure?.(project.id, id);
    else selectInOutline?.(id);
  }
  function showEveryStructure() {
    if (structureProjects) onshowallstructure?.();
    else onshowall?.();
  }
  onMount(() => {
    mac = /Mac|iPhone|iPad/.test(navigator.platform);
    perspectivesExpanded = navigationSectionExpandedPreference('perspectives');
    sequencesExpanded = navigationSectionExpandedPreference('sequences');
    const savedWidth = sidebarWidthPreference();
    sidebarWidth = savedWidth ?? sidebarElement.getBoundingClientRect().width;
    if (savedWidth) studio()?.style.setProperty('--sidebar-width', `${savedWidth}px`);
    return () => {
      clearTimeout(resizeTimer);
      studio()?.classList.remove('sidebar-resizing', 'sidebar-resize-settling');
    };
  });
  const jumpShortcut = SHORTCUTS.find((s) => s.id === 'jump')!;
  const label = (index: number) => String(index + 1).padStart(2, '0');
  function toggleSection(section: NavigationSection) {
    if (section === 'perspectives') {
      perspectivesExpanded = !perspectivesExpanded;
      rememberNavigationSectionExpanded(section, perspectivesExpanded);
    } else {
      sequencesExpanded = !sequencesExpanded;
      rememberNavigationSectionExpanded(section, sequencesExpanded);
    }
  }
  const studio = () => sidebarElement.closest<HTMLElement>('.studio');
  const clampedWidth = (width: number) =>
    Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
  function applySidebarWidth(width: number) {
    sidebarWidth = clampedWidth(width);
    studio()?.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  }
  function beginResize(event: PointerEvent) {
    if (event.button !== 0 || matchMedia('(max-width: 760px)').matches) return;
    resizeStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      width: sidebarElement.getBoundingClientRect().width
    };
    event.currentTarget instanceof HTMLElement &&
      event.currentTarget.setPointerCapture(event.pointerId);
    studio()?.classList.add('sidebar-resizing');
  }
  function moveResize(event: PointerEvent) {
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) return;
    applySidebarWidth(resizeStart.width + event.clientX - resizeStart.x);
  }
  function finishResize(event: PointerEvent) {
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) return;
    resizeStart = null;
    rememberSidebarWidth(sidebarWidth);
    const root = studio();
    root?.classList.remove('sidebar-resizing');
    root?.classList.add('sidebar-resize-settling');
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => root?.classList.remove('sidebar-resize-settling'), 220);
  }
  function resizeWithKeyboard(event: KeyboardEvent) {
    const width =
      event.key === 'ArrowLeft'
        ? sidebarWidth - 12
        : event.key === 'ArrowRight'
          ? sidebarWidth + 12
          : event.key === 'Home'
            ? SIDEBAR_MIN_WIDTH
            : event.key === 'End'
              ? SIDEBAR_MAX_WIDTH
              : null;
    if (width === null) return;
    event.preventDefault();
    applySidebarWidth(width);
    rememberSidebarWidth(sidebarWidth);
  }
</script>

{#snippet structureTree(project: StructureProject)}
  <div class="model-tree">
    {#each project.tree as element}<div
        class="tree-row"
        class:chosen={project.selected === element.id}
        class:proposed={element.status === 'proposed'}
        title={element.status === 'proposed' ? 'Proposed' : undefined}
        style={`--depth:${element.depth}`}
      >
        {#if project.model.elements.some((candidate) => candidate.parent === element.id)}<button
            class="tree-toggle"
            aria-label={`${project.expanded.includes(element.id) ? 'Collapse' : 'Expand'} ${element.title} in ${project.title} outline`}
            onclick={() => toggleStructure(project, element.id)}
            onpointerenter={(event) =>
              project.id === modelId &&
              requestPeek?.(element.id, event.currentTarget.getBoundingClientRect())}
            onpointerleave={() => project.id === modelId && clearPeek?.()}
            onfocus={(event) =>
              project.id === modelId &&
              requestPeek?.(element.id, event.currentTarget.getBoundingClientRect())}
            onblur={() => project.id === modelId && clearPeek?.()}
            >{#if project.expanded.includes(element.id)}<Minus size={11} />{:else}<Plus
                size={11}
              />{/if}</button
          >{:else}<span class="tree-leaf" style={`background:${element.color}`}></span>{/if}
        <button class="tree-title" onclick={() => selectStructure(project, element.id)}
          >{element.title}</button
        >
      </div>{/each}
  </div>
{/snippet}

<aside
  id="fractal-sidebar"
  class="sidebar"
  class:mobile-open={menuOpen}
  inert={sidebarCollapsed && !menuOpen}
  bind:this={sidebarElement}
  class:shaded
  use:floatingPanel={{ oncollapse: () => (shaded = !shaded) }}
>
  <div
    class="panel-grip"
    data-panel-grip
    title={shaded ? 'Double-click to unfold' : 'Drag to move · double-click to fold up'}
  >
    <span class="panel-shade-label">Navigation</span>
    <button
      class="icon-button panel-close"
      aria-label="Hide navigation"
      aria-controls="fractal-sidebar"
      onclick={onhide}><X size={15} /></button
    >
  </div>
  <div class="sidebar-body">
    <div class="sidebar-view-controls" aria-label="View controls">
      {#if surface === 'architecture'}
        <label
          class="view-toggle"
          use:tip={{
            title: 'Trust lens',
            text: 'Outline each element with the boundaries it belongs to. A boundary is a claim about membership, not an enforced rule.'
          }}
          ><input
            type="checkbox"
            checked={lens === 'trust'}
            onchange={(e) => onlens?.(e.currentTarget.checked ? 'trust' : 'structure')}
          /><span class="toggle-track"></span>Trust</label
        >
        <label
          class="view-toggle"
          use:tip={{
            title: 'Proposed',
            text: 'Include elements and relationships that are planned but not yet in place. They draw dashed.'
          }}
          ><input
            type="checkbox"
            checked={proposed}
            onchange={(e) => onproposed?.(e.currentTarget.checked)}
          /><span class="toggle-track"></span>Proposed</label
        >
      {/if}
      <button
        class="icon-button jump-button"
        aria-label="Jump to…"
        aria-keyshortcuts={shortcutLabel(jumpShortcut, mac)}
        use:tip={{
          title: 'Jump to…',
          text: `Search elements, perspectives and sequences. ${shortcutLabel(jumpShortcut, mac)}`
        }}
        onclick={onjump}><Search size={15} /></button
      >
    </div>
    <section class="nav-section" class:architecture-perspectives={surface === 'architecture'}>
      <button
        class="section-label section-toggle"
        aria-expanded={perspectivesExpanded}
        aria-controls="perspective-navigation"
        onclick={() => toggleSection('perspectives')}
        ><span class="section-name"><Grid size={12} aria-hidden="true" />PERSPECTIVES</span><span
          class="section-meta">{model?.scenes.length ?? 0}<ChevronDown size={12} /></span
        ></button
      >
      {#if perspectivesExpanded}
        <nav id="perspective-navigation" class="scenes" aria-label="Saved perspectives">
          {#each model?.scenes ?? [] as scene, i}
            {#if surface === 'architecture'}
              <button class:active={sceneId === scene.id} onclick={() => chooseScene?.(scene.id)}
                ><span class="scene-number">{label(i)}</span><span>{scene.title}</span
                >{#if sceneId === scene.id}<span class="active-dot"></span>{/if}</button
              >
            {:else}
              <a href={architectureLink(modelId, { scene: scene.id, theme })}
                ><span class="scene-number">{label(i)}</span><span>{scene.title}</span><span
                  class="leave"
                  aria-hidden="true">↗</span
                ></a
              >
            {/if}
          {/each}
        </nav>
        {#if surface === 'architecture'}
          <div
            class="sidebar-sections structure-section"
            role="group"
            aria-label="Perspective structure"
          >
            <div class="section-label structure-label">
              <span class="section-name"><Grid size={12} aria-hidden="true" />Structure</span><span
                class="structure-meta"
                >{structureCount}<button
                  class="show-all"
                  aria-label="Show all structure"
                  disabled={everyStructureShown}
                  onclick={showEveryStructure}>Show all</button
                ></span
              >
            </div>
            {#if outlines.length > 1}
              <div class="project-outlines">
                {#each outlines as project (project.id)}
                  <details class="project-outline" open data-structure-project={project.id}>
                    <summary>
                      <span>{project.title}</span><span class="project-outline-meta"
                        >{project.tree.length}<span class="project-outline-chevron"
                          ><ChevronDown size={11} /></span
                        ></span
                      >
                    </summary>
                    {@render structureTree(project)}
                  </details>
                {/each}
              </div>
            {:else if outlines[0]}
              {@render structureTree(outlines[0])}
            {/if}
          </div>
        {/if}
      {/if}
    </section>
    {#if journeys.length}
      <section
        class="nav-section sequence-section"
        class:architecture-sequences={surface === 'architecture'}
      >
        <button
          class="section-label section-toggle"
          aria-expanded={sequencesExpanded}
          aria-controls="sequence-contents"
          onclick={() => toggleSection('sequences')}
          ><span class="section-name"><Route size={12} aria-hidden="true" />SEQUENCES</span><span
            class="section-meta">{journeys.length}<ChevronDown size={12} /></span
          ></button
        >
        <div id="sequence-contents" class="sequence-contents" hidden={!sequencesExpanded}>
          <nav id="sequence-navigation" class="scenes" aria-label="Sequence journeys">
            {#each journeys as journey, i}
              {#if surface === 'sequence'}
                <button
                  class:active={journeyId === journey.id}
                  onclick={() => chooseJourney?.(journey.id)}
                  ><span class="scene-number">{label(i)}</span><span
                    >{journey.title}{#if journey.status === 'proposed'}<small class="proposed-label"
                        >Proposed</small
                      >{/if}</span
                  >{#if journeyId === journey.id}<span class="active-dot"></span>{/if}</button
                >
              {:else}
                <a href={sequenceLink(modelId, journey.id, theme)}
                  ><span class="scene-number">{label(i)}</span><span
                    >{journey.title}{#if journey.status === 'proposed'}<small class="proposed-label"
                        >Proposed</small
                      >{/if}</span
                  ><span class="leave" aria-hidden="true">↗</span></a
                >
              {/if}
            {/each}
          </nav>
          {#if surface === 'sequence'}
            <div
              class="sidebar-sections"
              role="group"
              aria-label={`${journeys.find((item) => item.id === journeyId)?.title ?? 'Sequence'} controls`}
            >
              {@render sections?.()}
            </div>
          {/if}
        </div>
      </section>
    {/if}
    <div class="sidebar-bottom">
      <button onclick={onsource} title={sourceLabel}
        ><Code size={16} /><span>Model source</span></button
      >
    </div>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable) -->
  <div
    class="sidebar-resizer"
    role="separator"
    aria-label="Resize navigation"
    aria-orientation="vertical"
    aria-valuemin={SIDEBAR_MIN_WIDTH}
    aria-valuemax={SIDEBAR_MAX_WIDTH}
    aria-valuenow={Math.round(sidebarWidth)}
    tabindex="0"
    onpointerdown={beginResize}
    onpointermove={moveResize}
    onpointerup={finishResize}
    onpointercancel={finishResize}
    onkeydown={resizeWithKeyboard}
  ></div>
  <button
    class="panel-resizer panel-resizer-y"
    aria-label="Resize navigation height"
    title="Drag to resize · double-click to fit content"
    use:panelResizer={{
      axes: 'y',
      initialHeight: panelHeightPreference('navigation'),
      onheight: (height) => rememberPanelHeight('navigation', height)
    }}
  ></button>
  <button
    class="panel-resizer panel-resizer-corner"
    aria-label="Resize navigation"
    use:panelResizer={{
      axes: 'xy',
      xEdge: 'right',
      onheight: (height) => rememberPanelHeight('navigation', height),
      onwidth: (width, phase) => {
        applySidebarWidth(width);
        if (phase === 'end') rememberSidebarWidth(sidebarWidth);
      }
    }}
  ></button>
</aside>

<style>
  .proposed-label {
    display: block;
    color: var(--proposed);
    font-size: 10px;
  }
  .leave {
    margin-left: auto;
    font-size: 11px;
    color: var(--subtle);
  }
  .structure-label {
    align-items: center;
  }
  .structure-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .show-all {
    border: 0;
    background: none;
    padding: 6px 0;
    color: var(--ui-muted);
    font-size: 10px;
    text-transform: none;
    letter-spacing: normal;
    font-weight: 400;
  }
  .show-all:disabled {
    opacity: 0.45;
  }
  .architecture-perspectives {
    display: flex;
    flex-direction: column;
    flex: 0 1 auto;
    min-height: 0;
  }
  .architecture-perspectives > .section-toggle {
    flex-shrink: 0;
  }
  .architecture-perspectives > .scenes {
    flex: 0 1 auto;
    min-height: 70px;
    overflow-y: auto;
  }
  .structure-section {
    flex: 0 1 auto;
    min-height: 0;
  }
  .structure-section .structure-label {
    margin-top: 12px;
  }
  .structure-section .model-tree {
    overflow: visible;
    padding-left: 0;
    padding-right: 0;
  }
  .project-outlines {
    display: grid;
    gap: 5px;
  }
  .project-outline summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 30px;
    padding: 4px 5px;
    border-radius: 5px;
    color: var(--ui-text, #283d34);
    font-size: 11px;
    font-weight: 560;
    cursor: pointer;
    list-style: none;
  }
  .project-outline summary::-webkit-details-marker {
    display: none;
  }
  .project-outline summary:hover,
  .project-outline summary:focus-visible {
    background: var(--ui-hover, #edf1ea);
    outline: none;
  }
  .project-outline-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ui-subtle, #7d887a);
    font-size: 10px;
    font-weight: 400;
  }
  .project-outline-chevron {
    display: flex;
    transition: transform 160ms ease;
  }
  .project-outline:not([open]) .project-outline-chevron {
    transform: rotate(-90deg);
  }
  .project-outline .model-tree {
    padding-bottom: 4px;
  }
  .project-outline .tree-row {
    padding-left: calc(12px + var(--depth) * 11px);
  }
  .architecture-sequences {
    flex-shrink: 0;
  }
  .sidebar-bottom {
    flex-shrink: 0;
  }
  @media (pointer: coarse) {
    .show-all {
      min-height: 44px;
    }
  }
</style>
