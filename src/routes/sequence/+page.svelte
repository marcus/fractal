<script lang="ts">
  import type { PageProps } from './$types';
  import { onMount, tick, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import SequencePhases from '$lib/components/SequencePhases.svelte';
  import {
    phaseEntries,
    setParticipantVisibility,
    setPhaseVisibility,
    visiblePhaseIds
  } from '$lib/sequence/visibility';
  import SequenceInspector from '$lib/components/SequenceInspector.svelte';
  import InspectorShell from '$lib/components/InspectorShell.svelte';
  import ThemeMenu from '$lib/components/ThemeMenu.svelte';
  import TooltipHost from '$lib/components/TooltipHost.svelte';
  import CornerControl from '$lib/components/CornerControl.svelte';
  import WordmarkFlyout from '$lib/components/WordmarkFlyout.svelte';
  import { floatingInsets } from '$lib/ui/floating-panel';
  import SequenceParticipants from '$lib/components/SequenceParticipants.svelte';
  import SequenceCanvas from '$lib/components/SequenceCanvas.svelte';
  import ModelNavigation from '$lib/components/ModelNavigation.svelte';
  import JumpDialog from '$lib/components/JumpDialog.svelte';
  import ShortcutSheet from '$lib/components/ShortcutSheet.svelte';
  import {
    lastProject,
    rememberLastProject,
    rememberSidebarCollapsed,
    sidebarCollapsedPreference,
    rememberTheme
  } from '$lib/ui/preferences';
  import { resolveShortcut, type CommandId } from '$lib/core/shortcuts';
  import { THEMES, getTheme, isThemeId } from '$lib/core/themes';
  import { architectureLink } from '$lib/core/links';
  import { revealHiddenLanes } from '$lib/sequence/layout';
  import type { Model } from '$lib/core/types';
  import type {
    SequenceDiagram,
    SequenceJourney,
    SequenceMessage,
    SequencePhase,
    SequenceStep,
    SequenceViewState
  } from '$lib/sequence/types';
  import {
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Download,
    Grid as Layers,
    Link,
    Keyboard,
    Play,
    Refresh,
    Sidebar,
    X
  } from '@marcusv/roc/svelte/outline';

  type CatalogItem = { id: string; title: string; description: string };
  type PhaseEntry = SequencePhase & { depth: number; parentId?: string };
  let catalog = $state<CatalogItem[]>([]);
  let catalogError = $state('');
  let model = $state<Model | null>(null);
  let modelId = $state('delivery');
  let journeys = $state<SequenceJourney[]>([]);
  let journeyId = $state('');
  let source = $state('');
  let revision = $state('');
  let diagram = $state<SequenceDiagram | null>(null);
  let { data }: PageProps = $props();
  // The server-chosen theme seeds the view once; scenes and the reader decide after that.
  // svelte-ignore state_referenced_locally
  let view = $state<SequenceViewState>({
    collapsedPhases: [],
    collapsedGroups: [],
    hiddenParticipants: [],
    theme: data.theme
  });
  let selected = $state<string | null>(null);
  /** What the inspector was open on when the link was made; restored once the journey renders. */
  let initialSelection: string | null = null;
  $effect(() => {
    void selected;
    if (diagram) untrack(updateUrl);
  });
  let busy = $state(true);
  /**
   * Waiting long enough to be worth saying so. `busy` still governs what a reader may do; this
   * governs only what the canvas shows about it, so a fast update never flashes a badge and never
   * dims the diagram the reader is looking at.
   */
  let slow = $state(false);
  const SLOW_REQUEST_MS = 150;
  $effect(() => {
    if (!busy) {
      slow = false;
      return;
    }
    const timer = setTimeout(() => (slow = true), SLOW_REQUEST_MS);
    return () => clearTimeout(timer);
  });
  let error = $state('');
  let exportError = $state('');
  let toast = $state('');
  let presentation = $state(false);
  let modal = $state<'projects' | 'jump' | 'shortcuts' | 'export' | 'source' | null>(null);
  let menuOpen = $state(false);
  let sidebarCollapsed = $state(sidebarCollapsedPreference());
  let sidebarMotion = $state(false);
  let sidebarTimer: ReturnType<typeof setTimeout>;
  let canvas = $state<{
    zoom: (direction: number) => void;
    fit: () => void;
    navigate: (direction: 'left' | 'right' | 'up' | 'down') => void;
    activate: () => void;
    toggleActive: () => void;
    outward: () => void;
  }>();
  let renderRequest = 0;
  let modelRequest = 0;
  let initialState: SequenceViewState | null = null;
  let toastTimer: ReturnType<typeof setTimeout>;

  const journey = $derived(journeys.find((item) => item.id === journeyId) ?? null);
  const theme = $derived(getTheme(isThemeId(view.theme) ? view.theme : undefined));
  $effect(() => rememberTheme(theme.id));
  const themeStyle = $derived(
    Object.entries(theme)
      .filter(([key]) => !['id', 'name', 'description', 'appearance'].includes(key))
      .map(([key, value]) => `--${key}:${value}`)
      .join(';') +
      (theme.id === 'grove'
        ? ''
        : `;--ui-text:${theme.text};--ui-muted:${theme.muted};--ui-subtle:${theme.subtle};--ui-card:${theme.card};--ui-surface:${theme.surface};--ui-hover:${theme.hover};--ui-border:${theme.border};--ui-accent:${theme.accent};--ui-accentText:${theme.accentText};--ui-proposed:${theme.proposed}`)
  );
  const phases = $derived(journey ? phaseEntries(journey) : []);
  const phaseFiltered = $derived(view.scopePhase !== undefined || view.visiblePhases !== undefined);
  const visiblePhases = $derived(journey ? visiblePhaseIds(journey, view) : []);
  const phasePath = $derived.by(() => {
    const scope =
      view.scopePhase ?? (view.visiblePhases?.length === 1 ? view.visiblePhases[0] : undefined);
    if (!scope) return [];
    const result: PhaseEntry[] = [];
    let current = phases.find((phase) => phase.id === scope);
    while (current) {
      result.unshift(current);
      current = current.parentId
        ? phases.find((phase) => phase.id === current?.parentId)
        : undefined;
    }
    return result;
  });
  const messages = $derived.by(() => {
    const result: SequenceMessage[] = [];
    const visit = (steps: SequenceStep[]) => {
      for (const step of steps) step.type === 'message' ? result.push(step) : visit(step.steps);
    };
    if (journey) visit(journey.steps);
    return result;
  });
  const journeyIndex = $derived(
    Math.max(
      0,
      journeys.findIndex((item) => item.id === journeyId)
    )
  );
  const selectedRow = $derived(diagram?.rows.find((row) => row.id === selected));
  const selectedColumn = $derived(diagram?.columns.find((column) => column.id === selected));
  const selectedMessages = $derived(
    selectedRow ? messages.filter((message) => selectedRow.messageIds.includes(message.id)) : []
  );

  /** Without an element this is the project's own architecture view, not a composed one. */
  function architectureHref(elementId?: string) {
    if (!elementId) return architectureLink(modelId, { theme: view.theme });
    const element = model?.elements.find((item) => item.id === elementId);
    const params = new URLSearchParams({ model: modelId });
    params.set(
      'view',
      JSON.stringify({
        expanded: [elementId],
        proposed: element?.status === 'proposed',
        lens: 'structure',
        scope: elementId,
        theme: view.theme ?? 'grove'
      })
    );
    return `/?${params}`;
  }

  function normalizedInitialState(value: unknown): SequenceViewState {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Saved sequence state must be an object.');
    const input = value as Record<string, unknown>;
    const allowed = new Set([
      'collapsedPhases',
      'collapsedGroups',
      'hiddenParticipants',
      'scopePhase',
      'visiblePhases',
      'theme'
    ]);
    const unsupported = Object.keys(input).find((key) => !allowed.has(key));
    if (unsupported) throw new Error(`Saved sequence state.${unsupported} is unsupported.`);
    const ids = (key: string) => {
      const candidate = input[key];
      if (candidate === undefined) return [];
      if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== 'string'))
        throw new Error(`Saved sequence ${key} must be an array of IDs.`);
      return candidate as string[];
    };
    if (input.scopePhase !== undefined && typeof input.scopePhase !== 'string')
      throw new Error('Saved sequence scopePhase must be an ID.');
    if (input.theme !== undefined && !isThemeId(input.theme))
      throw new Error(`Theme "${String(input.theme)}" is unknown.`);
    return {
      collapsedPhases: ids('collapsedPhases'),
      collapsedGroups: ids('collapsedGroups'),
      hiddenParticipants: ids('hiddenParticipants'),
      ...(input.visiblePhases !== undefined ? { visiblePhases: ids('visiblePhases') } : {}),
      ...(typeof input.scopePhase === 'string' ? { scopePhase: input.scopePhase } : {}),
      ...(isThemeId(input.theme) ? { theme: input.theme } : {})
    };
  }

  function readJson(response: Response) {
    return response.json().then((data) => {
      if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
      return data;
    });
  }
  function showDialog(node: HTMLDialogElement) {
    node.showModal();
    return { destroy: () => node.close() };
  }
  function announce(message: string) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3000);
  }
  function updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set('model', modelId);
    url.searchParams.set('journey', journeyId);
    url.searchParams.set('seq', JSON.stringify(view));
    // The selected row or lane rides beside the view, so a refresh or a copied link reopens
    // the inspector on the same thing.
    if (selected) url.searchParams.set('selected', selected);
    else url.searchParams.delete('selected');
    replaceState(url, {});
  }
  async function refreshCatalog() {
    try {
      catalog = await readJson(await fetch('/api/models'));
      catalogError = '';
    } catch (e) {
      catalogError = e instanceof Error ? e.message : String(e);
    }
  }
  function defaultState(item: SequenceJourney): SequenceViewState {
    return {
      collapsedPhases: item.steps.filter((step) => step.type === 'phase').map((step) => step.id),
      collapsedGroups: item.groups.map((group) => group.id),
      hiddenParticipants: [],
      theme: view.theme
    };
  }
  async function loadModel(
    id: string,
    requestedJourney?: string | null,
    preserveState = false,
    metadataOnly = false
  ) {
    const token = ++modelRequest;
    ++renderRequest;
    busy = true;
    error = '';
    selected = null;
    diagram = null;
    try {
      const result = await readJson(await fetch(`/api/models/${encodeURIComponent(id)}`));
      if (token !== modelRequest) return;
      model = result.model;
      journeys = result.sequences ?? [];
      source = result.sequenceSource ?? '';
      revision = result.revision;
      modelId = id;
      if (!journeys.length) {
        journeyId = '';
        diagram = null;
        throw new Error(`${result.model.title} has no authored sequence journeys yet.`);
      }
      if (
        requestedJourney &&
        !journeys.some((item: SequenceJourney) => item.id === requestedJourney)
      ) {
        journeyId = '';
        diagram = null;
        throw new Error(
          `Journey "${requestedJourney}" does not exist in ${result.model.title}. Choose an authored journey.`
        );
      }
      const nextJourney =
        journeys.find((item: SequenceJourney) => item.id === requestedJourney) ?? journeys[0];
      journeyId = nextJourney.id;
      if (!preserveState) view = initialState ?? defaultState(nextJourney);
      initialState = null;
      if (metadataOnly) return;
      await renderSequence();
      rememberLastProject(id);
    } catch (e) {
      if (token === modelRequest) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (token === modelRequest) busy = false;
    }
  }
  async function renderSequence() {
    if (!journeyId) return;
    const token = ++renderRequest;
    busy = true;
    error = '';
    try {
      const next = await readJson(
        await fetch('/api/sequence', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: modelId, journey: journeyId, state: view, revision })
        })
      );
      if (token !== renderRequest) return;
      diagram = next;
      view = next.state;
      if (initialSelection) {
        selected = initialSelection;
        initialSelection = null;
      }
      if (
        selected &&
        !next.rows.some((row: { id: string }) => row.id === selected) &&
        !next.columns.some((column: { id: string }) => column.id === selected)
      )
        selected = null;
      updateUrl();
      await tick();
    } catch (e) {
      if (token === renderRequest) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (token === renderRequest) busy = false;
    }
  }
  function chooseJourney(id: string) {
    const item = journeys.find((candidate) => candidate.id === id);
    if (!item) return;
    journeyId = id;
    selected = null;
    menuOpen = false;
    view = defaultState(item);
    renderSequence();
  }
  function advanceJourney(delta: number) {
    if (!journeys.length) return;
    const index = Math.max(
      0,
      journeys.findIndex((item) => item.id === journeyId)
    );
    chooseJourney(journeys[(index + delta + journeys.length) % journeys.length].id);
  }
  function togglePhase(id: string) {
    view = {
      ...view,
      collapsedPhases: view.collapsedPhases.includes(id)
        ? view.collapsedPhases.filter((item) => item !== id)
        : [...view.collapsedPhases, id]
    };
    renderSequence();
  }
  function changePhaseVisibility(next: SequenceViewState) {
    view = next;
    renderSequence();
  }
  function focusPhase(id: string) {
    if (journey) changePhaseVisibility(setPhaseVisibility(journey, view, id, 'only'));
  }
  function clearPhaseFocus() {
    if (!journey) return;
    selected = null;
    changePhaseVisibility(setPhaseVisibility(journey, view, '', 'all'));
  }
  function toggleGroup(id: string) {
    const group = journey?.groups.find((item) => item.id === id);
    if (!group) return;
    view = {
      ...view,
      collapsedGroups: view.collapsedGroups.includes(id)
        ? view.collapsedGroups.filter((item) => item !== id)
        : [...view.collapsedGroups, id]
    };
    renderSequence();
  }
  function changeParticipantVisibility(id: string, action: 'toggle' | 'only' | 'all') {
    if (!journey) return;
    const next = setParticipantVisibility(journey, view, id, action);
    if (!next) {
      announce('Keep at least one participant visible');
      return;
    }
    view = next;
    renderSequence();
  }
  function revealLanes(ids: string[]) {
    if (!journey) return;
    const stillHidden = ids.filter((id) => view.hiddenParticipants.includes(id));
    if (!stillHidden.length) return;
    view = revealHiddenLanes(journey, view, stillHidden);
    renderSequence();
  }
  function toggleSidebar() {
    if (matchMedia('(max-width: 760px)').matches) menuOpen = !menuOpen;
    else {
      sidebarMotion = true;
      sidebarCollapsed = !sidebarCollapsed;
      rememberSidebarCollapsed(sidebarCollapsed);
      clearTimeout(sidebarTimer);
      sidebarTimer = setTimeout(() => (sidebarMotion = false), 340);
    }
  }
  function chooseTheme(id: string) {
    if (!isThemeId(id)) return;
    view = { ...view, theme: id };
    renderSequence();
  }
  async function togglePresentation() {
    presentation = !presentation;
    modal = null;
    selected = null;
    menuOpen = false;
    await tick();
    document.querySelector<SVGSVGElement>('.sequence-canvas > svg')?.focus({ preventScroll: true });
  }
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportDiagram(format: 'svg' | 'png') {
    busy = true;
    exportError = '';
    try {
      const response = await fetch('/api/sequence/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId, journey: journeyId, state: view, revision })
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const svgBlob = await response.blob();
      if (format === 'svg') download(svgBlob, `${modelId}-${journeyId}.svg`);
      else {
        const url = URL.createObjectURL(svgBlob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const output = document.createElement('canvas');
          output.width = 3840;
          output.height = 2160;
          output.getContext('2d')!.drawImage(image, 0, 0, output.width, output.height);
          const png = await new Promise<Blob>((resolve, reject) =>
            output.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))),
              'image/png'
            )
          );
          download(png, `${modelId}-${journeyId}.png`);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      modal = null;
      announce(`${format.toUpperCase()} exported`);
    } catch (e) {
      exportError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  async function copyLink() {
    updateUrl();
    try {
      await navigator.clipboard.writeText(location.href);
      announce('Sequence link copied');
    } catch {
      announce('Copy the URL from your address bar');
    }
  }
  function executeCommand(command: CommandId) {
    switch (command) {
      case 'projects':
        modal = 'projects';
        refreshCatalog();
        break;
      case 'jump':
        modal = 'jump';
        refreshCatalog();
        break;
      case 'help':
        modal = 'shortcuts';
        break;
      case 'toggle-sidebar':
        if (!presentation) toggleSidebar();
        break;
      case 'toggle-presentation':
        if (diagram) togglePresentation();
        break;
      case 'export':
        if (diagram) modal = 'export';
        break;
      case 'copy-link':
        copyLink();
        break;
      case 'zoom-in':
        canvas?.zoom(1);
        break;
      case 'zoom-out':
        canvas?.zoom(-1);
        break;
      case 'fit':
        canvas?.fit();
        break;
      case 'previous-scene':
        advanceJourney(-1);
        break;
      case 'next-scene':
        advanceJourney(1);
        break;
      case 'move-left':
      case 'move-right':
      case 'move-up':
      case 'move-down':
        canvas?.navigate(command.slice(5) as 'left' | 'right' | 'up' | 'down');
        break;
      case 'inspect':
      case 'activate':
        canvas?.activate();
        break;
      case 'toggle':
        canvas?.toggleActive();
        break;
      case 'outward':
        canvas?.outward();
        break;
      case 'escape':
        if (modal) modal = null;
        else if (presentation) togglePresentation();
        else if (phaseFiltered) clearPhaseFocus();
        else canvas?.outward();
        break;
    }
  }
  function keydown(e: KeyboardEvent) {
    // Native popovers own focus and Escape while their controls are open.
    if (document.querySelector(':popover-open')) return;
    if (e.defaultPrevented) return;
    const target = e.target as Element;
    const command = resolveShortcut(e, {
      presentation,
      editable: !!target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
      ),
      interactive: !!target.closest('button, a, summary, [role="tab"]'),
      modal: !!modal,
      canvas: !!target.closest('.sequence-canvas > svg') || target === document.body
    });
    if (!command) return;
    e.preventDefault();
    executeCommand(command);
  }

  onMount(() => {
    const params = new URL(location.href).searchParams;
    let savedStateError = '';
    try {
      if (params.has('seq')) initialState = normalizedInitialState(JSON.parse(params.get('seq')!));
    } catch (e) {
      savedStateError = `${e instanceof SyntaxError ? 'The saved sequence view is not valid JSON.' : e instanceof Error ? e.message : 'The saved sequence view is invalid.'} Choose a journey to recover.`;
      initialState = null;
    }
    initialSelection = params.get('selected');
    if (!params.has('seq') && params.has('theme')) {
      const requestedTheme = params.get('theme');
      if (isThemeId(requestedTheme)) view = { ...view, theme: requestedTheme };
      else
        savedStateError = `Theme "${requestedTheme}" is unknown. Choose Grove, Graphite, or Midnight.`;
    }
    refreshCatalog().then(async () => {
      const requested = params.get('model');
      if (requested && !catalog.some((item) => item.id === requested)) {
        error = `Project "${requested}" is not in the catalog. Choose an available project.`;
        busy = false;
        return;
      }
      const recent = lastProject();
      const id =
        requested ?? (catalog.some((item) => item.id === recent) ? recent! : catalog[0]?.id);
      if (id) {
        await loadModel(id, params.get('journey'), false, !!savedStateError);
        if (savedStateError) error = savedStateError;
      } else {
        error = 'No projects configured. Open the project switcher to refresh your catalog.';
        busy = false;
      }
    });
    return () => {
      clearTimeout(toastTimer);
      clearTimeout(sidebarTimer);
      ++renderRequest;
      ++modelRequest;
    };
  });
</script>

<svelte:head><title>Fractal · {journey?.title ?? 'Sequence studio'}</title></svelte:head>
<svelte:window onkeydown={keydown} />

<div class="theme-root" data-theme={theme.id} style={themeStyle}>
  <TooltipHost />
  <div
    class="studio"
    class:presenting={presentation}
    class:sidebar-collapsed={sidebarCollapsed}
    class:sidebar-motion={sidebarMotion}
  >
    {#if !presentation}
      <header class="appbar">
        {#if journey}
          <nav class="appbar-breadcrumb" aria-label="Current location">
            <button class="crumb-scene" disabled={!phaseFiltered} onclick={clearPhaseFocus}
              >{journey.title}</button
            >
            {#each phasePath as phase, index}
              <ChevronRight size={13} />
              <button
                disabled={index === phasePath.length - 1}
                aria-current={index === phasePath.length - 1 ? 'page' : undefined}
                onclick={() => focusPhase(phase.id)}>{phase.title}</button
              >
            {/each}
            {#if phaseFiltered && !phasePath.length}
              <ChevronRight size={13} />
              <button disabled aria-current="page"
                >{visiblePhases.length} of {phases.length} phases</button
              >
            {/if}
            <span class="appbar-subtitle" title={journey.description}>{journey.description}</span>
          </nav>
        {/if}
        <button
          class="mobile-menu icon-button appbar-nav-toggle"
          aria-label="Open perspectives"
          onclick={() => (menuOpen = !menuOpen)}><Layers size={18} /></button
        >
        <div class="top-actions">
          <button
            class="icon-button"
            title="Copy sequence link"
            aria-label="Copy sequence link"
            onclick={copyLink}><Link size={17} /></button
          >
          <button
            class="icon-button"
            title="Reload sequence"
            aria-label="Reload sequence"
            disabled={busy}
            onclick={() => loadModel(modelId, journeyId, true)}><Refresh size={17} /></button
          >
          <button
            class="icon-button"
            title="Keyboard Shortcuts"
            aria-label="Keyboard Shortcuts"
            onclick={() => (modal = 'shortcuts')}><Keyboard size={17} /></button
          >
          <button
            class="icon-button"
            title="Export sequence"
            aria-label="Export sequence"
            disabled={!diagram || busy}
            onclick={() => (modal = 'export')}><Download size={17} /></button
          >
          <ThemeMenu theme={theme.id} onchoose={chooseTheme} />
          <button
            class="icon-button present-button"
            title="Present"
            aria-label="Present"
            disabled={!diagram}
            onclick={togglePresentation}><Play size={15} /></button
          >
          <button
            class="project-switcher"
            aria-label={`Switch project: ${model?.title ?? 'Projects'}`}
            aria-haspopup="dialog"
            onclick={() => (modal = 'projects')}
          >
            <span>{model?.title ?? 'Projects'}</span><ChevronDown size={13} />
          </button>
        </div>
      </header>
      <ModelNavigation
        surface="sequence"
        {model}
        {modelId}
        {journeys}
        {journeyId}
        {menuOpen}
        {sidebarCollapsed}
        {chooseJourney}
        sceneId={null}
        theme={view.theme}
        sourceLabel="sequences.json"
        onjump={() => {
          modal = 'jump';
          refreshCatalog();
        }}
        onsource={() => (modal = 'source')}
        {sections}
        onhide={toggleSidebar}
      />
    {/if}

    <main class:with-inspector={!presentation && !!selected}>
      <div class="composition">
        <div class="composition-heading">
          <div class="composition-title-row">
            <h1>{journey?.title ?? 'Sequence studio'}</h1>
            {#if journey}<span class="status-chip" class:proposed={journey.status === 'proposed'}
                >{journey.status}</span
              >{/if}
          </div>
          <p title={journey?.provenance}>
            {journey?.description ?? 'Choose an authored journey to explore its interactions.'}
          </p>
        </div>
        <div class="diagram-area" class:loading={slow}>
          {#if diagram && model}<SequenceCanvas
              bind:this={canvas}
              {diagram}
              {selected}
              {presentation}
              onselect={(id) => (selected = id)}
              ontogglephase={togglePhase}
              ontogglegroup={toggleGroup}
              onreveallanes={revealLanes}
              measureInsets={() =>
                floatingInsets({ navigationHidden: sidebarCollapsed || presentation })}
            />{/if}
          {#if diagram && !diagram.rows.length && phaseFiltered && !busy}
            <div class="phase-empty" role="status">
              No phases shown <button onclick={clearPhaseFocus}>Show all</button>
            </div>
          {/if}
          {#if slow}<div class="loading-badge"><span></span>Updating sequence</div>{/if}
        </div>
      </div>
      {#if !presentation}
        <CornerControl
          class="nav-toggle-corner"
          label={sidebarCollapsed ? 'Show navigation' : 'Hide navigation'}
          controls="fractal-sidebar"
          expanded={!sidebarCollapsed}
          onclick={toggleSidebar}><Sidebar size={18} /></CornerControl
        >
        <WordmarkFlyout />
      {/if}
      {#if error}<div class="error" role="alert">
          {error}{#if catalog.length}<button class="button" onclick={() => (modal = 'projects')}
              >Choose project</button
            >{/if}
        </div>{/if}
    </main>

    {#if !presentation && selected && journey}
      <InspectorShell
        label={selectedRow?.title ?? selectedColumn?.title ?? 'Selection'}
        onclose={() => (selected = null)}
      >
        {#key `${modelId}:${journeyId}:${selected}`}
          <SequenceInspector
            row={selectedRow}
            column={selectedColumn}
            messages={selectedMessages}
            {journey}
            {architectureHref}
          />
        {/key}
      </InspectorShell>
    {/if}
    {#if presentation}<div class="presentation-controls">
        <button aria-label="Previous journey" onclick={() => advanceJourney(-1)}
          ><ChevronLeft size={17} /></button
        >
        <div>
          <span>{String(journeyIndex + 1).padStart(2, '0')}</span> / {journeys.length || 1}
        </div>
        <button aria-label="Next journey" onclick={() => advanceJourney(1)}
          ><ChevronRight size={17} /></button
        ><span class="divider"></span><button
          aria-label="Export presentation scene"
          onclick={() => (modal = 'export')}><Download size={17} /></button
        ><button
          aria-label="Exit presentation"
          title="Exit presentation (Esc)"
          onclick={() => (presentation = false)}><X size={17} /></button
        >
      </div>{/if}
  </div>

  {#if modal === 'projects' || modal === 'jump'}<JumpDialog
      model={null}
      projects={catalog}
      currentProject={modelId}
      {journeys}
      projectsOnly={modal === 'projects'}
      {catalogError}
      onpick={() => (location.href = architectureLink(modelId, { theme: view.theme }))}
      onsequence={(id) => {
        modal = null;
        chooseJourney(id);
      }}
      onproject={(id) => {
        modal = null;
        initialState = null;
        loadModel(id);
      }}
      onrefresh={refreshCatalog}
      onclose={() => (modal = null)}
    />{/if}
  {#if modal === 'shortcuts'}<ShortcutSheet
      {presentation}
      surface="sequence"
      onclose={() => (modal = null)}
    />{/if}
  {#if modal === 'source' || modal === 'export'}
    <div
      class="modal-backdrop"
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget) modal = null;
      }}
    >
      <dialog
        use:showDialog
        class="modal"
        class:source-modal={modal === 'source'}
        oncancel={(e) => {
          e.preventDefault();
          modal = null;
        }}
        aria-label={modal === 'source' ? 'Sequence source' : 'Export sequence'}
        tabindex="-1"
      >
        <div class="modal-heading">
          <div>
            <div class="eyebrow">{modal === 'source' ? 'AUTHORED SOURCE' : 'TAKE IT WITH YOU'}</div>
            <h2>
              {modal === 'source' ? 'Journeys, as text.' : 'Ready for your next conversation.'}
            </h2>
          </div>
          <button class="icon-button" aria-label="Close dialog" onclick={() => (modal = null)}
            ><X size={18} /></button
          >
        </div>
        {#if modal === 'source'}<p>
            Authored journeys describe the interactions. Fractal composes the projection. Edit the
            local source and reload the journey to see changes.
          </p>
          <pre class="source-text">{source || 'Model source is unavailable.'}</pre>
          <div class="modal-actions">
            <span class="modal-revision">Revision {revision.slice(0, 12)}</span><button
              class="button primary"
              onclick={() => {
                modal = null;
                loadModel(modelId, journeyId, true);
              }}>Reload source</button
            >
          </div>
        {:else}<p>
            The same geometry you see in the studio, as a clean 16:9 composition of
            <strong>{journey?.title ?? 'this journey'}</strong>.
          </p>
          {#if exportError}<p class="dialog-error" role="alert">{exportError}</p>{/if}
          <div class="export-options">
            <button aria-label="Download SVG" disabled={busy} onclick={() => exportDiagram('svg')}
              ><div>
                <strong>Download SVG</strong><span>Scalable artwork for proposals and slides</span>
              </div>
              <Download size={18} /></button
            ><button aria-label="Download PNG" disabled={busy} onclick={() => exportDiagram('png')}
              ><div>
                <strong>Download PNG</strong><span>3840 × 2160 · ready to drop into a deck</span>
              </div>
              <Download size={18} /></button
            >
          </div>
          <div class="modal-footer">
            Editor controls are excluded from the exported artwork.
          </div>{/if}
      </dialog>
    </div>
  {/if}
  {#if toast}<div class="toast" role="status"><Check size={15} />{toast}</div>{/if}
</div>

{#snippet sections()}
  {#if journey}
    <SequencePhases {journey} {view} onchange={changePhaseVisibility} />
    {#key `${modelId}:${journeyId}`}
      <SequenceParticipants
        {journey}
        {view}
        onvisibility={changeParticipantVisibility}
        ontogglegroup={toggleGroup}
      />
    {/key}
  {/if}
{/snippet}

<style>
  .phase-empty {
    position: absolute;
    inset: 45% 0 auto;
    text-align: center;
    color: var(--muted);
  }
  .phase-empty button {
    margin-left: 12px;
    border: 0;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .source-text {
    min-height: 0;
    overflow: auto;
    max-height: 46vh;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--muted);
    font-size: 10px;
    line-height: 1.55;
  }
  .modal-revision {
    margin-right: auto;
    color: var(--subtle);
    font-size: 10px;
  }
</style>
