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
    ArrowRight,
    ArrowDown,
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
  import type { Model, LayoutNode, LayoutEngineId, ThemeId } from '$lib/core/types';

  type Journey = { id: string; title: string; status: 'current' | 'proposed' };
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
    flow,
    onflow,
    sourceLabel = '.c4',
    sections
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
    /** The engine placing the view; absent is the default left-to-right flow. */
    flow?: LayoutEngineId;
    onflow?: (layout: LayoutEngineId | undefined) => void;
    sourceLabel?: string;
    /** Surface-specific navigation, shown where the architecture outline sits. */
    sections?: Snippet;
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
  const flowShortcut = SHORTCUTS.find((s) => s.id === 'toggle-flow')!;
  const flowDown = $derived(flow === 'elk-layered-down');
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
        <button
          class="icon-button flow-toggle"
          class:down={flowDown}
          role="switch"
          aria-checked={flowDown}
          aria-label="Flow top to bottom"
          aria-keyshortcuts={shortcutLabel(flowShortcut, mac)}
          use:tip={{
            title: 'Flow',
            text: `Lay the diagram out top to bottom instead of left to right. Useful on tall screens, portrait pages and embeds. ${shortcutLabel(flowShortcut, mac)}`
          }}
          onclick={() => onflow?.(flowDown ? undefined : 'elk-layered-down')}
          >{#if flowDown}<ArrowDown size={15} />{:else}<ArrowRight size={15} />{/if}</button
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
                >{tree.length}<button
                  class="show-all"
                  aria-label="Show all structure"
                  disabled={allShown}
                  onclick={onshowall}>Show all</button
                ></span
              >
            </div>
            <div class="model-tree">
              {#each tree as element}<div
                  class="tree-row"
                  class:chosen={selected === element.id}
                  class:proposed={element.status === 'proposed'}
                  title={element.status === 'proposed' ? 'Proposed' : undefined}
                  style={`--depth:${element.depth}`}
                >
                  {#if model?.elements.some((e) => e.parent === element.id)}<button
                      class="tree-toggle"
                      aria-label={`${expanded.includes(element.id) ? 'Collapse' : 'Expand'} ${element.title} in outline`}
                      onclick={() => {
                        clearPeek?.();
                        toggle?.(element.id);
                      }}
                      onpointerenter={(e) =>
                        requestPeek?.(element.id, e.currentTarget.getBoundingClientRect())}
                      onpointerleave={() => clearPeek?.()}
                      onfocus={(e) =>
                        requestPeek?.(element.id, e.currentTarget.getBoundingClientRect())}
                      onblur={() => clearPeek?.()}
                      >{#if expanded.includes(element.id)}<Minus size={11} />{:else}<Plus
                          size={11}
                        />{/if}</button
                    >{:else}<span class="tree-leaf" style={`background:${element.color}`}
                    ></span>{/if}
                  <button class="tree-title" onclick={() => selectInOutline?.(element.id)}
                    >{element.title}</button
                  >
                </div>{/each}
            </div>
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
  /* The arrow is the state: it points the way the diagram flows, and turns accent when the
     view is no longer on the default engine. Quiet until hovered, like the row's other controls. */
  .flow-toggle {
    width: 26px;
    height: 26px;
    color: var(--ui-muted, #7d886f);
  }
  .flow-toggle.down {
    color: var(--ui-accent, #8b9d62);
  }
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
