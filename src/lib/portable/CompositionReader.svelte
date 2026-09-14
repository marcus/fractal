<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import CompositionCanvas, { type ProjectAction } from '../components/CompositionCanvas.svelte';
  import InspectorPanel from '../components/InspectorPanel.svelte';
  import ShortcutSheet from '../components/ShortcutSheet.svelte';
  import ThemeMenu from '../components/ThemeMenu.svelte';
  import TooltipHost from '../components/TooltipHost.svelte';
  import WordmarkFlyout from '../components/WordmarkFlyout.svelte';
  import { compose } from '../composition/compose';
  import { compositionStateFromUrl, compositionStateToUrl } from '../composition/codec';
  import { parseCompositionState } from '../composition/parse';
  import { searchComposition } from '../composition/search';
  import { staticResolver } from '../composition/snapshot';
  import {
    closeProject,
    focusProject,
    openProject,
    setProjectMode,
    setProjectScene,
    setProjectScope
  } from '../composition/state';
  import type {
    ComposedDiagram,
    ComposedPort,
    CompositionState,
    DiagramLink,
    QualifiedSelection
  } from '../composition/types';
  import { getTheme, isThemeId } from '../core/themes';
  import { resolveShortcut, shortcutLabel, SHORTCUTS } from '../core/shortcuts';
  import { tip } from '../ui/tooltip.svelte';
  import { ArrowRight, ArrowDown } from '@marcusv/roc/svelte/outline';
  import { exportSvg } from '../core/svg';
  import { isLayoutEngineId } from '../core/layout-engines';
  import { floatingInsets } from '../ui/floating-panel';
  import type { Model, ViewState } from '../core/types';
  import {
    LINKED_CONTRACT_VERSION,
    snapshotsForResolver,
    type PortableLinkedDocument
  } from './document';

  let { document: snapshot }: { document: PortableLinkedDocument } = $props();
  const snapshots = untrack(() => snapshot.snapshots);
  const projectSnapshots = untrack(() => snapshotsForResolver(snapshots));
  const snapshotMap = untrack(() => new Map(projectSnapshots.map((entry) => [entry.id, entry])));
  const resolver = untrack(() => staticResolver(projectSnapshots));
  const models = untrack(() => {
    const record: Record<string, Model> = {};
    for (const entry of snapshots) record[entry.id] = entry.model;
    return record;
  });
  const linksByModel = untrack(() => {
    const record: Record<string, (typeof snapshots)[number]['links']> = {};
    for (const entry of snapshots) record[entry.id] = entry.links;
    return record;
  });
  const included = untrack(() => new Set(snapshots.map((entry) => entry.id)));
  const root = untrack(() => snapshots[0]);

  let live = $state<CompositionState>(untrack(() => snapshot.composition));
  let composed = $state.raw<ComposedDiagram>(untrack(() => snapshot.composed));
  let selection = $state<QualifiedSelection | null>(
    untrack(() => snapshot.composition.selection ?? null)
  );
  let navOpen = $state(false);
  let helpOpen = $state(false);
  let query = $state('');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let ready = false;
  let renderId = 0;
  let canvas = $state<CompositionCanvas>();
  let mac = $state(false);
  let unsupported = $state('');

  const theme = $derived(getTheme(live.theme));
  const title = $derived(root?.model.title ?? 'Fractal');
  const subtitle = $derived(
    'Snapshot of linked projects. It does not update when repositories change.'
  );
  const results = $derived(
    query.trim() ? searchComposition(snapshotMap, live, query).slice(0, 20) : []
  );
  const themeStyle = $derived(
    Object.entries(theme)
      .filter(([key]) => !['id', 'name', 'description', 'appearance'].includes(key))
      .map(([key, value]) => `--${key}:${value}`)
      .join(';') +
      `;--ui-text:${theme.text};--ui-muted:${theme.muted};--ui-subtle:${theme.subtle};--ui-card:${theme.card};--ui-surface:${theme.surface};--ui-hover:${theme.hover};--ui-border:${theme.border};--ui-accent:${theme.accent};--ui-accentText:${theme.accentText};--ui-proposed:${theme.proposed}`
  );
  const insets = () => floatingInsets({ navigationHidden: !navOpen });
  const flowDown = $derived(live.layout === 'elk-layered-down');
  const flowShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'toggle-flow')!;
  const selectedModel = $derived(
    selection === null
      ? null
      : selection.kind === 'connection'
        ? selection.ownerModel
        : selection.model
  );
  const inspectorModel = $derived(
    selectedModel && models[selectedModel] ? models[selectedModel] : root.model
  );
  const inspectorDiagram = $derived.by(() => {
    if (!selectedModel)
      return composed.projects.find((project) => project.model === root.id)?.diagram ?? null;
    if (selection?.kind !== 'element' && selection?.kind !== 'relationship')
      return composed.projects.find((project) => project.model === selectedModel)?.diagram ?? null;
    return composed.projects.find((project) => project.model === selectedModel)?.diagram ?? null;
  });
  const inspectorView = $derived.by((): ViewState => {
    const entry = selectedModel
      ? live.projects.find((project) => project.model === selectedModel)
      : live.projects[0];
    if (!entry)
      return {
        expanded: [],
        proposed: false,
        lens: 'structure',
        theme: live.theme,
        layout: live.layout
      };
    return {
      ...entry.view,
      theme: live.theme,
      layout: live.layout
    };
  });
  const inspectorSelected = $derived.by(() => {
    if (!selection) return '';
    if (selection.kind === 'element') return selection.element;
    if (selection.kind === 'relationship') return selection.relationship;
    if (selection.kind === 'connection') return selection.connectionId;
    return '';
  });
  const inspectorSelectedType = $derived.by(() => {
    if (selection?.kind === 'connection') return 'connection' as const;
    if (selection?.kind === 'relationship') return 'relationship' as const;
    return 'element' as const;
  });
  const inspectorLinks = $derived.by(() => {
    const owner = inspectorModel.id;
    const authored = linksByModel[owner] ?? null;
    const targets = new Map<string, { model: string; status: string; message?: string }>();
    for (const link of authored?.links ?? []) {
      if (included.has(link.target.model))
        targets.set(link.target.model, { model: link.target.model, status: 'resolved' });
      else
        targets.set(link.target.model, {
          model: link.target.model,
          status: 'unavailable',
          message:
            'Not included in this snapshot. The document does not update when repositories change.'
        });
    }
    return {
      links: authored,
      resolution: [...targets.values()].sort((a, b) =>
        a.model < b.model ? -1 : a.model > b.model ? 1 : 0
      )
    };
  });

  type Anchor = {
    model: string;
    kind: 'title' | 'content';
    screen: { x: number; y: number };
    scale: number;
  };

  function captureAnchor(model: string): Anchor | null {
    const screen = canvas?.screenOfTitle(model);
    if (!screen) return null;
    return { model, kind: 'title', screen: { x: screen.x, y: screen.y }, scale: screen.scale };
  }

  function placeAnchor(anchor: Anchor | null) {
    if (!anchor || !canvas) return;
    const offset =
      anchor.kind === 'title'
        ? (canvas.titleOffset(anchor.model) ?? { x: 0, y: 0 })
        : (canvas.contentOffset(anchor.model) ?? { x: 0, y: 0 });
    canvas.placeContent({ offset, screen: anchor.screen, scale: anchor.scale });
  }

  function saveLink() {
    if (!ready) return;
    const next = parseCompositionState({ ...live, selection: selection ?? undefined });
    const hash = new URLSearchParams();
    compositionStateToUrl(next, hash);
    history.replaceState(null, '', `${location.pathname}${location.search}#${hash}`);
  }

  async function render(next: CompositionState, follow?: string) {
    const id = ++renderId;
    const anchor = follow ? captureAnchor(follow) : null;
    busy = true;
    error = '';
    try {
      const result = await compose(resolver, next);
      if (id !== renderId) return;
      live = result.state;
      composed = result;
      if (selection && !selectionSurvives(result, selection)) selection = null;
      saveLink();
      await tick();
      if (anchor) placeAnchor(anchor);
    } catch (cause) {
      if (id === renderId) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (id === renderId) busy = false;
    }
  }

  function selectionSurvives(diagram: ComposedDiagram, current: QualifiedSelection): boolean {
    if (current.kind === 'connection')
      return diagram.bridges.some((bridge) =>
        bridge.underlying.some(
          (entry) =>
            entry.owner === current.ownerModel && entry.connectionId === current.connectionId
        )
      );
    if (current.kind === 'element')
      return diagram.projects.some(
        (project) =>
          project.model === current.model &&
          project.diagram?.nodes.some((node) => node.id === current.element)
      );
    if (current.kind === 'relationship')
      return diagram.projects.some(
        (project) =>
          project.model === current.model &&
          project.diagram?.edges.some((edge) => edge.id === current.relationship)
      );
    return diagram.state.projects.some((project) => project.model === current.model);
  }

  function select(next: QualifiedSelection) {
    selection = next;
    saveLink();
  }

  function clearSelection() {
    selection = null;
    saveLink();
  }

  function toggleElement(model: string, id: string) {
    const entry = live.projects.find((project) => project.model === model);
    if (!entry) return;
    const expanded = entry.view.expanded.includes(id)
      ? entry.view.expanded.filter((item) => item !== id)
      : [...entry.view.expanded, id];
    void render(
      parseCompositionState({
        ...live,
        projects: live.projects.map((project) =>
          project.model === model ? { ...project, view: { ...project.view, expanded } } : project
        )
      }),
      model
    );
  }

  function focusElement(id: string) {
    if (!selectedModel) return;
    void render(
      focusProject(setProjectScope(live, selectedModel, id), selectedModel),
      selectedModel
    );
  }

  function inspectElement(id: string) {
    const modelId = selectedModel ?? root.id;
    const entry = live.projects.find((project) => project.model === modelId);
    if (!entry) return;
    const expanded = entry.view.expanded.includes(id)
      ? entry.view.expanded
      : [...entry.view.expanded, id];
    selection = { kind: 'element', model: modelId, element: id };
    void render(
      parseCompositionState({
        ...live,
        projects: live.projects.map((project) =>
          project.model === modelId ? { ...project, view: { ...project.view, expanded } } : project
        )
      }),
      modelId
    ).then(async () => {
      await tick();
      canvas?.revealElement(modelId, id);
    });
  }

  function fullSystem() {
    if (!selectedModel) return;
    void render(setProjectScope(live, selectedModel, undefined), selectedModel);
  }

  function openLink(link: DiagramLink) {
    if (live.projects.some((project) => project.model === link.target.model)) {
      canvas?.revealProject(link.target.model);
      return;
    }
    const target = snapshotMap.get(link.target.model);
    const source = selectedModel ?? root.id;
    if (target) {
      void render(openProject(live, target, link.target.scene), source);
      return;
    }
    // Excluded and unavailable targets stay placeholders; never fetch.
    void render(
      parseCompositionState({
        ...live,
        projects: [
          ...live.projects,
          {
            model: link.target.model,
            ...(link.target.scene === undefined ? {} : { scene: link.target.scene }),
            mode: 'open' as const,
            view: { expanded: [], proposed: false, lens: 'structure' }
          }
        ]
      }),
      source
    );
  }

  function projectAction(target: string, action: ProjectAction) {
    if (action === 'standalone') {
      notice = 'This snapshot is read-only. It does not update when repositories change.';
      return;
    }
    if (action === 'fit') {
      canvas?.fitProject(target);
      return;
    }
    try {
      if (typeof action !== 'string') {
        if (action.kind === 'scene') {
          const loaded = snapshotMap.get(target);
          if (!loaded) return;
          void render(setProjectScene(live, target, action.scene, loaded), target);
          return;
        }
        void render(
          focusProject(
            setProjectScope(live, target, action.element),
            action.element ? target : undefined
          ),
          target
        );
        return;
      }
      if (action === 'close') {
        void render(closeProject(live, target), live.root);
        return;
      }
      void render(
        setProjectMode(live, target, action === 'collapse' ? 'collapsed' : 'open'),
        target
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function revealPort(port: ComposedPort) {
    void render(setProjectScope(live, port.reveal.model, port.reveal.element), port.reveal.model);
  }

  function toggleFlow() {
    void render(
      parseCompositionState({
        ...live,
        layout: flowDown ? 'elk-layered' : 'elk-layered-down'
      })
    );
  }

  function download() {
    const project = composed.projects.find((entry) => entry.model === (selectedModel ?? root.id));
    const model = models[project?.model ?? root.id];
    if (!project?.diagram || !model) {
      notice = 'No local diagram is open to download.';
      return;
    }
    const svg = exportSvg(model, project.diagram, {
      title: `${model.title} / ${project.scene ?? 'view'}`,
      subtitle: model.description
    });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${model.id}.svg`;
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
    switch (command) {
      case 'move-left':
        canvas?.navigate('left');
        break;
      case 'move-right':
        canvas?.navigate('right');
        break;
      case 'move-up':
        canvas?.navigate('up');
        break;
      case 'move-down':
        canvas?.navigate('down');
        break;
      case 'activate':
      case 'inspect':
      case 'toggle':
        break;
      case 'help':
        helpOpen = true;
        break;
      case 'fit':
        canvas?.fit();
        break;
      case 'zoom-in':
        canvas?.zoom(1);
        break;
      case 'zoom-out':
        canvas?.zoom(-1);
        break;
      case 'toggle-sidebar':
        navOpen = !navOpen;
        break;
      case 'toggle-flow':
        toggleFlow();
        break;
      case 'copy-link':
        void copyLink();
        break;
      case 'export':
        download();
        break;
      case 'escape':
        if (helpOpen) helpOpen = false;
        else if (canvas?.dismissMenu()) break;
        else if (navOpen) navOpen = false;
        else if (selection) clearSelection();
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
      const restored = compositionStateFromUrl(hash);
      if (!restored) return;
      selection = restored.selection ?? null;
      void render(restored);
    } catch {
      notice =
        'This view link could not be restored. The published starting composition is still available.';
    }
  }

  onMount(() => {
    document.getElementById('fractal-linked-required')?.remove();
    if (snapshot.linkedContract > LINKED_CONTRACT_VERSION) {
      unsupported = `This document uses linked-project contract v${snapshot.linkedContract}. This reader supports v${LINKED_CONTRACT_VERSION} and will not present it as a complete composition.`;
      return;
    }
    ready = true;
    mac = /Mac|iPhone|iPad/.test(navigator.platform);
    restoreLink();
  });
</script>

<svelte:window onkeydown={keyboard} onhashchange={restoreLink} />
<div
  class="studio portable"
  data-theme={theme.id}
  data-linked-contract={snapshot.linkedContract}
  data-linked-readonly="true"
  style={themeStyle}
>
  {#if unsupported}
    <div class="portable-status" role="alert">{unsupported}</div>
  {:else}
    <header class="appbar">
      <div class="portable-heading">
        <strong>{title}</strong><span>Linked composition</span>
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
        {#if selection}<button class="button" aria-label="Close details" onclick={clearSelection}
            >×</button
          >{/if}
        <button
          class="icon-button flow-button"
          class:flowing-down={flowDown}
          role="switch"
          aria-checked={flowDown}
          aria-label="Flow top to bottom"
          aria-keyshortcuts={shortcutLabel(flowShortcut, mac)}
          use:tip={{
            title: 'Flow',
            text: `Lay the diagram out top to bottom instead of left to right. Useful on tall screens, portrait pages and embeds. ${shortcutLabel(flowShortcut, mac)}`
          }}
          onclick={toggleFlow}
          >{#if flowDown}<ArrowDown size={17} />{:else}<ArrowRight size={17} />{/if}</button
        >
        <ThemeMenu
          theme={theme.id}
          onchoose={(id) => {
            if (isThemeId(id) && isLayoutEngineId(live.layout)) {
              void render(parseCompositionState({ ...live, theme: id }));
            }
          }}
        />
      </div>
    </header>
    <main>
      <CompositionCanvas
        bind:this={canvas}
        {composed}
        {models}
        {selection}
        onselect={select}
        ontoggle={toggleElement}
        onprojectaction={projectAction}
        onrevealport={revealPort}
        measureInsets={insets}
      />
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
                  const entry = live.projects.find(
                    (project) => project.model === result.reveal.model
                  );
                  if (entry) {
                    void render(
                      parseCompositionState({
                        ...live,
                        projects: live.projects.map((project) =>
                          project.model === result.reveal.model
                            ? {
                                ...project,
                                view: { ...project.view, expanded: result.reveal.expanded }
                              }
                            : project
                        )
                      }),
                      result.reveal.model
                    );
                  }
                  selection = result.selection;
                  navOpen = false;
                  query = '';
                }}>{result.title}</button
              >{:else}<p>No matches.</p>{/each}
          </div>
        {/if}
        <h2>Included projects</h2>
        {#each snapshots as item}
          <button
            class:current={live.projects.some(
              (project) => project.model === item.id && project.mode === 'open'
            )}
            onclick={() => {
              if (live.projects.some((project) => project.model === item.id)) {
                canvas?.revealProject(item.id);
                navOpen = false;
                return;
              }
              const loaded = snapshotMap.get(item.id);
              if (loaded) void render(openProject(live, loaded), live.root);
              navOpen = false;
            }}>{item.model.title}</button
          >
        {/each}
        {#if snapshot.excluded.length}
          <h2>Excluded links</h2>
          {#each snapshot.excluded as link}
            <p class="excluded-link">{link.title} · {link.target.model}</p>
          {/each}
        {/if}
        <div class="portable-switches">
          <label
            ><input
              type="checkbox"
              checked={live.projects[0]?.view.lens === 'trust'}
              onchange={(e) => {
                const lens = e.currentTarget.checked ? 'trust' : 'structure';
                void render(
                  parseCompositionState({
                    ...live,
                    projects: live.projects.map((project) =>
                      project.model === live.root
                        ? { ...project, view: { ...project.view, lens } }
                        : project
                    )
                  }),
                  live.root
                );
              }}
            />Trust</label
          ><label
            ><input
              type="checkbox"
              checked={live.projects[0]?.view.proposed}
              onchange={(e) => {
                const proposed = e.currentTarget.checked;
                void render(
                  parseCompositionState({
                    ...live,
                    projects: live.projects.map((project) =>
                      project.model === live.root
                        ? { ...project, view: { ...project.view, proposed } }
                        : project
                    )
                  }),
                  live.root
                );
              }}
            />Proposed</label
          >
        </div>
        <h2>Share this view</h2>
        <button onclick={copyLink}>Copy view link</button>
        <button onclick={download}>Download SVG</button>
        <details open>
          <summary>Sources & context</summary>
          <p>{root.model.provenance}</p>
          <p>
            This file is a snapshot of the explicit included set. Imported models are read-only and
            do not update when repositories change. Evidence pointers describe sources; source files
            are not embedded. Excluded and unavailable links stay placeholders and never fetch.
          </p>
          <p>Reader linked-project contract v{snapshot.linkedContract}.</p>
        </details>
        {#if snapshot.licenses}<details>
            <summary>Reader licenses</summary>
            <pre class="portable-licenses">{snapshot.licenses}</pre>
          </details>{/if}
      </nav>
    {/if}
    {#if selection}
      <InspectorPanel
        model={inspectorModel}
        diagram={inspectorDiagram}
        selected={inspectorSelected}
        selectedType={inspectorSelectedType}
        view={inspectorView}
        composition={{
          state: live,
          composed,
          models,
          links: linksByModel
        }}
        compositionSelection={selection}
        links={inspectorLinks}
        toggle={(id) => toggleElement(inspectorModel.id, id)}
        focus={focusElement}
        {inspectElement}
        {fullSystem}
        onopenlink={openLink}
        onshowproposed={(id) => {
          void render(
            parseCompositionState({
              ...live,
              projects: live.projects.map((project) =>
                project.model === id
                  ? { ...project, view: { ...project.view, proposed: true } }
                  : project
              )
            }),
            id
          );
        }}
        onclose={clearSelection}
        onsettled={() => {
          if (selection?.kind === 'element')
            canvas?.revealElement(selection.model, selection.element);
        }}
      />
    {/if}
    {#if helpOpen}<ShortcutSheet surface="portable" onclose={() => (helpOpen = false)} />{/if}
    <div class="portable-zoom" aria-label="Zoom controls">
      <button aria-label="Zoom out" onclick={() => canvas?.zoom(-1)}>−</button><button
        aria-label="Zoom in"
        onclick={() => canvas?.zoom(1)}>+</button
      >
    </div>
    <WordmarkFlyout />
    <TooltipHost />
    {#if busy}<div class="portable-status" role="status">Arranging view…</div>{/if}
    {#if error}<div class="portable-status" role="alert">{error}</div>{/if}
    {#if notice}<button class="portable-status" onclick={() => (notice = '')}>{notice}</button>{/if}
  {/if}
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
  .excluded-link {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--muted);
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
