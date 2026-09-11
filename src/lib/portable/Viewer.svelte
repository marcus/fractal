<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import DiagramCanvas from '../components/DiagramCanvas.svelte';
  import InspectorPanel from '../components/InspectorPanel.svelte';
  import ShortcutSheet from '../components/ShortcutSheet.svelte';
  import InspectorShell from '../components/InspectorShell.svelte';
  import SequenceCanvas from '../components/SequenceCanvas.svelte';
  import SequenceInspector from '../components/SequenceInspector.svelte';
  import ThemeMenu from '../components/ThemeMenu.svelte';
  import DiagramKey from '../components/DiagramKey.svelte';
  import TooltipHost from '../components/TooltipHost.svelte';
  import WordmarkFlyout from '../components/WordmarkFlyout.svelte';
  import { getTheme, isThemeId } from '../core/themes';
  import { resolveShortcut } from '../core/shortcuts';
  import { outwardView, showAllStructure } from '../core/navigation';
  import { searchModel, revealSearchResult } from '../core/search';
  import { layout } from '../adapters/elk-layout';
  import { exportSvg } from '../core/svg';
  import { layoutSequence } from '../sequence/layout';
  import { exportSequenceSvg } from '../sequence/svg';
  import { floatingInsets } from '../ui/floating-panel';
  import type { Diagram, ViewState } from '../core/types';
  import type { SequenceViewState, SequenceStep, SequenceMessage } from '../sequence/types';
  import type { PortableDocument } from './document';

  let { document: snapshot }: { document: PortableDocument } = $props();
  const model = untrack(() => snapshot.model);
  let view = $state<ViewState>(untrack(() => snapshot.view));
  let diagram = $state.raw<Diagram>(untrack(() => snapshot.diagram));
  let sceneId = $state(untrack(() => snapshot.scene));
  let journeyId = $state('');
  let sequenceView = $state<SequenceViewState>({
    collapsedPhases: [],
    collapsedGroups: [],
    hiddenParticipants: []
  });
  let selected = $state<string | null>(null);
  let selectedType = $state<'element' | 'relationship' | 'outside'>('element');
  let navOpen = $state(false);
  let helpOpen = $state(false);
  let query = $state('');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let ready = false;
  let renderId = 0;
  let canvas = $state<DiagramCanvas>();
  let sequenceCanvas = $state<SequenceCanvas>();
  const scene = $derived(model.scenes.find((item) => item.id === sceneId)!);
  const journey = $derived(snapshot.sequences.find((item) => item.id === journeyId));
  const sequenceDiagram = $derived(
    journey ? layoutSequence(journey, { ...sequenceView, theme: view.theme }) : null
  );
  const theme = $derived(getTheme(view.theme));
  const title = $derived(journey?.title ?? scene?.title ?? model.title);
  const subtitle = $derived(journey?.description ?? scene?.description ?? model.description);
  const results = $derived(query.trim() ? searchModel(model, query).slice(0, 20) : []);
  const themeStyle = $derived(
    Object.entries(theme)
      .filter(([key]) => !['id', 'name', 'description', 'appearance'].includes(key))
      .map(([key, value]) => `--${key}:${value}`)
      .join(';') +
      `;--ui-text:${theme.text};--ui-muted:${theme.muted};--ui-subtle:${theme.subtle};--ui-card:${theme.card};--ui-surface:${theme.surface};--ui-hover:${theme.hover};--ui-border:${theme.border};--ui-accent:${theme.accent};--ui-accentText:${theme.accentText};--ui-proposed:${theme.proposed}`
  );
  const insets = () => floatingInsets({ navigationHidden: !navOpen });
  const messages = (step: SequenceStep): SequenceMessage[] =>
    step.type === 'message' ? [step] : step.steps.flatMap(messages);
  const sequenceRow = $derived(sequenceDiagram?.rows.find((row) => row.id === selected));
  const sequenceColumn = $derived(
    sequenceDiagram?.columns.find((column) => column.id === selected)
  );

  function saveLink() {
    if (!ready) return;
    const hash = new URLSearchParams({ scene: sceneId, view: JSON.stringify(view) });
    if (selected) {
      hash.set('selected', selected);
      hash.set('type', selectedType);
    }
    if (journeyId) {
      hash.set('journey', journeyId);
      hash.set('seq', JSON.stringify(sequenceView));
    }
    history.replaceState(null, '', `${location.pathname}${location.search}#${hash}`);
  }
  async function render(follow?: string) {
    const id = ++renderId;
    busy = true;
    error = '';
    try {
      const next = await layout(model, $state.snapshot(view));
      if (id !== renderId) return;
      if (follow) canvas?.followOnLayout(next, follow);
      diagram = next;
      saveLink();
    } catch (cause) {
      if (id === renderId) error = String(cause);
    } finally {
      if (id === renderId) busy = false;
    }
  }
  function chooseScene(id: string) {
    const next = model.scenes.find((item) => item.id === id);
    if (!next) return;
    sceneId = id;
    journeyId = '';
    selected = null;
    view = {
      expanded: [...next.expanded],
      proposed: next.proposed,
      lens: next.lens,
      scope: next.scope,
      theme: next.theme ?? view.theme
    };
    navOpen = false;
    void render().then(() => canvas?.fit());
  }
  function select(id: string, type: typeof selectedType = 'element') {
    selected = id;
    selectedType = type;
    saveLink();
  }
  function clearSelection() {
    selected = null;
    saveLink();
  }
  function toggle(id: string) {
    view = {
      ...view,
      expanded: view.expanded.includes(id)
        ? view.expanded.filter((item) => item !== id)
        : [...view.expanded, id]
    };
    void render(id);
  }
  function focus(id: string) {
    view = { ...view, scope: id, expanded: [...new Set([...view.expanded, id])] };
    void render().then(() => canvas?.fit());
  }
  function inspectElement(id: string) {
    const result = searchModel(model, id).find(
      (entry) => entry.type === 'element' && entry.id === id
    );
    if (result) view = revealSearchResult(model, view, result).view;
    journeyId = '';
    selected = id;
    selectedType = 'element';
    void render().then(async () => {
      await tick();
      canvas?.reveal(id);
    });
  }
  function outward(id: string | null) {
    const next = outwardView(model, view, id);
    view = next.state;
    selected = null;
    void render();
  }
  function chooseJourney(id: string) {
    journeyId = id;
    selected = null;
    navOpen = false;
    sequenceView = { collapsedPhases: [], collapsedGroups: [], hiddenParticipants: [] };
    saveLink();
  }
  function toggleSequence(key: 'collapsedPhases' | 'collapsedGroups', id: string) {
    const values = sequenceView[key];
    sequenceView = {
      ...sequenceView,
      [key]: values.includes(id) ? values.filter((item) => item !== id) : [...values, id]
    };
    saveLink();
  }
  function download() {
    const svg =
      journey && sequenceDiagram
        ? exportSequenceSvg(journey, sequenceDiagram)
        : exportSvg(model, diagram, { title: `${model.title} / ${title}`, subtitle });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${model.id}-${journeyId || sceneId}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copyLink() {
    saveLink();
    try {
      await navigator.clipboard.writeText(location.href);
      notice = 'View link copied';
    } catch {
      notice = 'Copy the address bar to share this view';
    }
  }
  function keyboard(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const command = resolveShortcut(event, {
      presentation: false,
      modal: helpOpen,
      canvas: !!target.closest('svg'),
      editable: !!target.closest('input,textarea,[contenteditable="true"]'),
      interactive: !!target.closest('button,a,select,summary')
    });
    const activeCanvas = journey ? sequenceCanvas : canvas;
    switch (command) {
      case 'move-left':
        activeCanvas?.navigate('left');
        break;
      case 'move-right':
        activeCanvas?.navigate('right');
        break;
      case 'move-up':
        activeCanvas?.navigate('up');
        break;
      case 'move-down':
        activeCanvas?.navigate('down');
        break;
      case 'activate':
      case 'inspect':
        activeCanvas?.activate();
        break;
      case 'toggle':
        activeCanvas?.toggleActive();
        break;
      case 'outward':
        if (journey) sequenceCanvas?.outward();
        else canvas?.exitLayer();
        break;
      case 'help':
        helpOpen = true;
        break;
      case 'fit':
        activeCanvas?.fit();
        break;
      case 'zoom-in':
        activeCanvas?.zoom(1);
        break;
      case 'zoom-out':
        activeCanvas?.zoom(-1);
        break;
      case 'toggle-sidebar':
        navOpen = !navOpen;
        break;
      case 'copy-link':
        void copyLink();
        break;
      case 'export':
        download();
        break;
      case 'escape':
        if (helpOpen) helpOpen = false;
        else if (navOpen) navOpen = false;
        else if (selected) clearSelection();
        else if (!journey) canvas?.exitLayer();
        break;
      case 'jump':
        navOpen = true;
        void tick().then(() => document.getElementById('portable-search')?.focus());
        break;
      default:
        return;
    }
    event.preventDefault();
  }
  function restoreLink() {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (!hash.size) return;
    try {
      const nextScene = model.scenes.find((item) => item.id === hash.get('scene'));
      if (nextScene) {
        sceneId = nextScene.id;
        // A scene-only link is an authored view, independent of the last explored scope.
        // Explicit view state below still wins for links to customized perspectives.
        view = {
          expanded: [...nextScene.expanded],
          proposed: nextScene.proposed,
          lens: nextScene.lens,
          scope: nextScene.scope,
          theme: nextScene.theme
        };
      }
      if (hash.has('view')) {
        const next = JSON.parse(hash.get('view')!);
        if (
          !Array.isArray(next.expanded) ||
          !next.expanded.every((id: unknown) => typeof id === 'string') ||
          typeof next.proposed !== 'boolean' ||
          !['structure', 'trust'].includes(next.lens) ||
          (next.theme !== undefined && !isThemeId(next.theme)) ||
          (next.scope !== undefined && !model.elements.some((item) => item.id === next.scope))
        )
          throw new Error('Invalid view');
        view = next;
      }
      journeyId = snapshot.sequences.some((item) => item.id === hash.get('journey'))
        ? hash.get('journey')!
        : '';
      if (journeyId && hash.has('seq')) {
        const next = JSON.parse(hash.get('seq')!);
        for (const key of ['collapsedPhases', 'collapsedGroups', 'hiddenParticipants'])
          if (
            !Array.isArray(next[key]) ||
            !next[key].every((id: unknown) => typeof id === 'string')
          )
            throw new Error('Invalid sequence view');
        sequenceView = next;
      }
      selected = hash.get('selected');
      selectedType =
        hash.get('type') === 'relationship'
          ? 'relationship'
          : hash.get('type') === 'outside'
            ? 'outside'
            : 'element';
      const element = hash.get('element');
      if (element && model.elements.some((item) => item.id === element)) inspectElement(element);
      else void render();
    } catch {
      notice =
        'This view link could not be restored. The published starting view is available from Perspectives.';
    }
  }
  onMount(() => {
    ready = true;
    restoreLink();
  });
</script>

<svelte:window onkeydown={keyboard} onhashchange={restoreLink} />
<div class="studio portable" data-theme={theme.id} style={themeStyle}>
  <header class="appbar">
    <div class="portable-heading">
      <strong>{model.title}</strong><span
        >{title}{#if journey?.status === 'proposed'}
          · Proposed{/if}</span
      >
      <p>{subtitle}</p>
    </div>
    <div class="top-actions">
      <button
        class="button"
        aria-expanded={navOpen}
        aria-controls="fractal-sidebar"
        onclick={() => (navOpen = !navOpen)}>Explore</button
      >
      <button class="button secondary-action" onclick={copyLink}>Copy link</button>
      <button class="button secondary-action" onclick={download}>SVG</button>
      <button class="button" aria-label="Keyboard shortcuts" onclick={() => (helpOpen = true)}
        >?</button
      >
      {#if selected}<button class="button" aria-label="Close details" onclick={clearSelection}
          >×</button
        >{/if}
      <ThemeMenu
        theme={theme.id}
        onchoose={(id) => {
          if (isThemeId(id)) {
            view = { ...view, theme: id };
            void render();
          }
        }}
      />
    </div>
  </header>
  <main>
    {#if journey && sequenceDiagram}
      <SequenceCanvas
        bind:this={sequenceCanvas}
        diagram={sequenceDiagram}
        {selected}
        onselect={(id) => select(id)}
        ontogglephase={(id) => toggleSequence('collapsedPhases', id)}
        ontogglegroup={(id) => toggleSequence('collapsedGroups', id)}
        onreveallanes={(ids) => {
          sequenceView = {
            ...sequenceView,
            hiddenParticipants: sequenceView.hiddenParticipants.filter((id) => !ids.includes(id))
          };
          saveLink();
        }}
        measureInsets={insets}
      />
    {:else}
      <DiagramCanvas
        bind:this={canvas}
        {diagram}
        {model}
        {selected}
        onselect={select}
        ontoggle={toggle}
        onexitlayer={outward}
        oncommandkey={keyboard}
        measureInsets={insets}
      />
      <DiagramKey {model} {diagram} onoutside={() => select('__outside__', 'outside')} />
    {/if}
  </main>
  {#if navOpen}
    <nav id="fractal-sidebar" class="portable-nav" aria-label="Explore document">
      <label for="portable-search">Find a component or connection</label>
      <input
        id="portable-search"
        type="search"
        bind:value={query}
        placeholder="Search architecture…"
      />
      {#if query}
        <div class="portable-results">
          {#each results as result}<button
              onclick={() => {
                const next = revealSearchResult(model, view, result);
                view = next.view;
                selected = next.selected?.id ?? null;
                selectedType = result.type === 'relationship' ? 'relationship' : 'element';
                journeyId = '';
                navOpen = false;
                void render();
              }}>{result.title}</button
            >{:else}<p>No matches.</p>{/each}
        </div>
      {/if}
      <h2>Perspectives</h2>
      {#each model.scenes as item}<button
          class:current={!journey && sceneId === item.id}
          onclick={() => chooseScene(item.id)}
          >{item.title}{item.proposed ? ' · Proposed' : ''}</button
        >{/each}
      {#if !journey}
        <div class="portable-switches">
          <label
            ><input
              type="checkbox"
              checked={view.lens === 'trust'}
              onchange={(e) => {
                view = { ...view, lens: e.currentTarget.checked ? 'trust' : 'structure' };
                void render();
              }}
            />Trust</label
          ><label
            ><input
              type="checkbox"
              checked={view.proposed}
              onchange={(e) => {
                view = { ...view, proposed: e.currentTarget.checked };
                void render();
              }}
            />Proposed</label
          >
        </div>
        <button
          onclick={() => {
            view = showAllStructure(model, view);
            void render();
          }}>Expand all structure</button
        >
        <button
          onclick={() => {
            view = { ...view, expanded: [] };
            void render();
          }}>Collapse all structure</button
        >
        {#if view.scope}<button
            onclick={() => {
              view = { ...view, scope: undefined };
              void render().then(() => canvas?.fit());
            }}>Full system</button
          >{/if}
      {/if}
      {#if snapshot.sequences.length}<h2>Sequences</h2>
        {#each snapshot.sequences as item}<button
            class:current={journeyId === item.id}
            onclick={() => chooseJourney(item.id)}
            >{item.title}{item.status === 'proposed' ? ' · Proposed' : ''}</button
          >{/each}{/if}
      <h2>Share this view</h2>
      <button onclick={copyLink}>Copy view link</button>
      <button onclick={download}>Download SVG</button>
      <details>
        <summary>Sources & context</summary>
        <p>{model.provenance}</p>
        <p>
          This snapshot includes the full authored model. Evidence pointers describe sources; source
          files are not embedded.
        </p>
      </details>
      {#if snapshot.licenses}<details>
          <summary>Reader licenses</summary>
          <pre class="portable-licenses">{snapshot.licenses}</pre>
        </details>{/if}
    </nav>
  {/if}
  {#if selected}
    {#if journey && (sequenceRow || sequenceColumn)}
      <InspectorShell
        label={sequenceRow?.title ?? sequenceColumn?.title ?? 'Selection'}
        onclose={clearSelection}
        onsettled={() => {}}
        ><SequenceInspector
          row={sequenceRow}
          column={sequenceColumn}
          messages={journey.steps
            .flatMap(messages)
            .filter((message) => sequenceRow?.messageIds.includes(message.id))}
          {journey}
          architectureHref={(id) => `#element=${encodeURIComponent(id)}`}
        /></InspectorShell
      >
    {:else if !journey}
      <InspectorPanel
        {model}
        {diagram}
        {selected}
        {selectedType}
        {view}
        {toggle}
        {focus}
        {inspectElement}
        fullSystem={() => {
          view = { ...view, scope: undefined };
          void render();
        }}
        onclose={clearSelection}
        onsettled={() => {
          if (selected) canvas?.reveal(selected, true);
        }}
      />
    {/if}
  {/if}
  {#if helpOpen}<ShortcutSheet surface="portable" onclose={() => (helpOpen = false)} />{/if}
  <div class="portable-zoom" aria-label="Zoom controls">
    <button aria-label="Zoom out" onclick={() => (journey ? sequenceCanvas : canvas)?.zoom(-1)}
      >−</button
    ><button aria-label="Zoom in" onclick={() => (journey ? sequenceCanvas : canvas)?.zoom(1)}
      >+</button
    >
  </div>
  <WordmarkFlyout />
  <TooltipHost />
  {#if busy}<div class="portable-status" role="status">Arranging view…</div>{/if}
  {#if error}<div class="portable-status" role="alert">{error}</div>{/if}
  {#if notice}<button class="portable-status" onclick={() => (notice = '')}>{notice}</button>{/if}
</div>

<style>
  .portable {
    background: var(--canvas);
    color: var(--text);
    min-height: 360px;
  }
  .portable-heading {
    min-width: 0;
    max-width: 65%;
    text-shadow: 0 0 10px var(--canvas);
  }
  .portable-heading strong {
    font-size: 16px;
    font-weight: 560;
    letter-spacing: 0.01em;
  }
  .portable-heading > span {
    margin-left: 14px;
    color: var(--muted);
  }
  .portable-heading p {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .top-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .portable-nav {
    position: absolute;
    z-index: 6;
    top: calc(var(--panel-top) + 10px);
    left: var(--float-gap);
    width: 280px;
    max-width: calc(100vw - 40px);
    max-height: calc(100dvh - 160px);
    overflow: auto;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--card);
    box-shadow: var(--float-shadow);
  }
  .portable-nav h2 {
    font-size: 12px;
    margin: 22px 0 8px;
    font-weight: 580;
    color: var(--muted);
  }
  .portable-nav > label {
    display: block;
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .portable-nav input[type='search'] {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 8px;
    color: var(--text);
    border-radius: 6px;
  }
  .portable-nav button {
    display: block;
    text-align: left;
    background: transparent;
    border: none;
    width: 100%;
    padding: 9px 6px;
    border-radius: 5px;
  }
  .portable-nav button:hover,
  .portable-nav button.current {
    background: var(--hover);
  }
  .portable-switches {
    display: flex;
    gap: 18px;
    margin: 14px 0;
    font-size: 12px;
  }
  .portable-switches label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .portable-nav details {
    margin-top: 22px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.6;
  }
  .portable-licenses {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 10px;
  }
  .portable-nav summary {
    cursor: pointer;
  }
  .portable-status {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100vw - 170px);
    z-index: 9;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card);
    color: var(--text);
    padding: 12px 18px;
    font-size: 12px;
  }
  .portable-zoom {
    position: absolute;
    bottom: var(--float-gap);
    left: calc(var(--float-gap) + 48px);
    display: flex;
    border-radius: 10px;
    background: var(--card);
    z-index: 4;
  }
  .portable-zoom button {
    width: 36px;
    height: 36px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    font-size: 18px;
  }
  .portable-zoom button:hover {
    background: var(--hover);
  }
  @media (max-width: 760px) {
    .top-actions :global(.theme-menu .icon-button) {
      display: flex;
    }
    .secondary-action {
      display: none;
    }
    .portable-heading {
      max-width: 50%;
    }
    .portable-heading > span {
      display: none;
    }
    .portable-heading strong {
      font-size: 13px;
    }
    .portable-heading p {
      display: none;
    }
    .top-actions :global(.button) {
      padding: 5px;
      font-size: 11px;
    }
  }
</style>
