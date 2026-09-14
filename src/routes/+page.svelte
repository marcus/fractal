<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import DiagramCanvas from '$lib/components/DiagramCanvas.svelte';
  import CompositionCanvas, { type ProjectAction } from '$lib/components/CompositionCanvas.svelte';
  import type { ProjectLinks } from '$lib/composition/types';
  import ModelNavigation from '$lib/components/ModelNavigation.svelte';
  import JumpDialog from '$lib/components/JumpDialog.svelte';
  import ShortcutSheet from '$lib/components/ShortcutSheet.svelte';
  import { resolveShortcut, shortcutLabel, SHORTCUTS, type CommandId } from '$lib/core/shortcuts';
  import { tip } from '$lib/ui/tooltip.svelte';
  import { revealSearchResult, type SearchResult } from '$lib/core/search';
  import DiagramKey from '$lib/components/DiagramKey.svelte';
  import InspectorPanel from '$lib/components/InspectorPanel.svelte';
  import ThemeMenu from '$lib/components/ThemeMenu.svelte';
  import TooltipHost from '$lib/components/TooltipHost.svelte';
  import CornerControl from '$lib/components/CornerControl.svelte';
  import WordmarkFlyout from '$lib/components/WordmarkFlyout.svelte';
  import {
    Sidebar,
    Download,
    Play,
    ChevronRight,
    ChevronLeft,
    X,
    Grid as Layers,
    ArrowUpRight,
    Link,
    Keyboard,
    Check,
    ChevronDown,
    ArrowRight,
    ArrowDown
  } from '@marcusv/roc/svelte/outline';
  import { THEMES, getTheme, isThemeId } from '$lib/core/themes';
  import { sequenceLink } from '$lib/core/links';
  import { floatingInsets } from '$lib/ui/floating-panel';
  import { outwardView, showAllStructure, type Direction } from '$lib/core/navigation';
  import {
    lastProject,
    rememberLastProject,
    rememberSidebarCollapsed,
    rememberTheme,
    sidebarCollapsedPreference
  } from '$lib/ui/preferences';
  import type { Model, Diagram, ViewState } from '$lib/core/types';
  import { CompositionContractError, parseCompositionState } from '$lib/composition/parse';
  import {
    closeProject,
    focusProject,
    openProject,
    rootState,
    setProjectMode,
    setProjectScene,
    setProjectScope
  } from '$lib/composition/state';
  import {
    COMPOSITION_URL_PARAM,
    compositionStateFromUrl,
    compositionStateToUrl
  } from '$lib/composition/codec';
  import { searchComposition, type CompositionSearchResult } from '$lib/composition/search';
  import { isStale, nextGeneration } from '$lib/composition/revision';
  import type { ProjectSnapshot } from '$lib/composition/snapshot';
  import type {
    ComposedDiagram,
    ComposedPort,
    CompositionState,
    DiagramLink,
    QualifiedSelection
  } from '$lib/composition/types';
  import type { PageProps } from './$types';

  interface LinkResolution {
    model: string;
    status: 'resolved' | 'unavailable' | 'invalid';
    message?: string;
  }
  interface LinksResult {
    model: string;
    revision: string;
    links: ProjectLinks | null;
    resolution: LinkResolution[];
  }
  interface CompositionSession {
    state: CompositionState;
    composed: ComposedDiagram;
    revisions: Record<string, string>;
  }
  type RevisionNotice = {
    kind: 'revision_changed' | 'source_changing' | 'budget_exceeded';
    model?: string;
    message: string;
  };

  let catalog = $state<{ id: string; title: string; description: string }[]>([]);
  let catalogError = $state('');
  let journeys = $state<
    { id: string; title: string; description: string; status: 'current' | 'proposed' }[]
  >([]);
  let catalogRequestId = 0;
  let model = $state<Model | null>(null);
  let modelId = $state('delivery');
  let source = $state('');
  let revision = $state('');
  let exportPreview = $state('');
  let previewError = $state('');
  let diagram = $state<Diagram | null>(null);
  let { data }: PageProps = $props();
  // The server-chosen theme seeds the view once; scenes and the reader decide after that.
  // svelte-ignore state_referenced_locally
  let view = $state<ViewState>({
    expanded: [],
    proposed: false,
    lens: 'structure',
    theme: data.theme
  });
  let sceneId = $state<string | null>('overview');
  // Exploration changes the view without losing the presenter's place in the story.
  let sceneAnchor = $state<string | null>('overview');
  let renderedSceneAnchor: string | null = null;
  /** The inspector's subject: a node, an edge, or the connections beyond this view. */
  const OUTSIDE = '__outside__';
  let selected = $state<string | null>(null);
  let selectedType = $state<'element' | 'relationship' | 'outside' | 'connection'>('element');
  let busy = $state(true);
  /**
   * Waiting long enough to be worth saying so. `busy` still governs what a reader may do; this
   * governs only what the canvas shows about it, so a warm toggle that answers in a few
   * milliseconds never flashes a badge and never dims the diagram the reader is looking at.
   */
  let slow = $state(false);
  const SLOW_REQUEST_MS = 150;
  let error = $state('');
  let toast = $state('');
  let presentation = $state(false);
  let modal = $state<'source' | 'export' | 'jump' | 'projects' | 'shortcuts' | null>(null);
  let diagramKey = $state<{ close: () => boolean; toggle: () => void }>();
  let exporting = $state(false);
  let menuOpen = $state(false);
  let sidebarCollapsed = $state(sidebarCollapsedPreference());
  const measureInsets = () =>
    floatingInsets({ navigationHidden: sidebarCollapsed || presentation });
  let sidebarMotion = $state(false);
  let sidebarTimer: ReturnType<typeof setTimeout>;
  let canvas = $state<{
    followOnLayout: (diagram: Diagram, id: string) => void;
    reveal: (id: string, automatic?: boolean) => void;
    navigate: (direction: Direction) => void;
    activate: () => void;
    toggleActive: () => void;
    zoom: (direction: number) => void;
    fit: () => void;
    exitLayer: () => void;
    clearPeek: () => boolean;
    requestPeek: (id: string, box: DOMRect) => void;
    screenOfOrigin: () => { x: number; y: number; scale: number };
  }>();
  /** Linked composition: the composed result, its participating models, and the qualified selection. */
  let composition = $state<CompositionSession | null>(null);
  let compositionModels = $state<Record<string, Model>>({});
  let compositionSelection = $state<QualifiedSelection | null>(null);
  let compositionRequestId = 0;
  let compositionGeneration = 0;
  let compositionLinks = $state<Record<string, LinksResult>>({});
  let revisionNotice = $state<RevisionNotice | null>(null);
  let pendingComposition: CompositionState | undefined;
  /** Keep a composed point at its screen position across a re-layout. */
  let compositionAnchor: {
    model: string;
    kind: 'content' | 'title';
    screen: { x: number; y: number };
    scale: number;
  } | null = null;

  let composedCanvas = $state<{
    placeContent: (value: {
      offset: { x: number; y: number };
      screen: { x: number; y: number };
      scale: number;
    }) => void;
    screenOfTitle: (model: string) => { x: number; y: number; scale: number } | null;
    screenOfContent: (model: string) => { x: number; y: number; scale: number } | null;
    titleOffset: (model: string) => { x: number; y: number } | null;
    contentOffset: (model: string) => { x: number; y: number } | null;
    revealProject: (model: string) => void;
    revealElement: (model: string, id: string) => void;
    fit: () => void;
    fitProject: (model: string) => void;
    zoom: (direction: number) => void;
    navigate: (direction: Direction) => void;
    dismissMenu: () => boolean;
  }>();
  let authoredLinks = $state<LinksResult | null>(null);
  let authoredLinksModel = $state('');
  const inComposition = $derived(composition !== null);
  const selectedCompositionModel = $derived(
    compositionSelection === null
      ? null
      : compositionSelection.kind === 'connection'
        ? compositionSelection.ownerModel
        : compositionSelection.model
  );
  const inspectorModel = $derived(
    inComposition && selectedCompositionModel && compositionModels[selectedCompositionModel]
      ? compositionModels[selectedCompositionModel]
      : model
  );
  const inspectorDiagram = $derived.by(() => {
    if (!inComposition || !selectedCompositionModel) return diagram;
    if (compositionSelection?.kind !== 'element' && compositionSelection?.kind !== 'relationship')
      return diagram;
    return (
      composition?.composed.projects.find((entry) => entry.model === selectedCompositionModel)
        ?.diagram ?? null
    );
  });
  const inspectorComposition = $derived(
    composition
      ? {
          state: composition.state,
          composed: composition.composed,
          models: compositionModels,
          links: Object.fromEntries(
            Object.entries(compositionLinks).map(([id, result]) => [id, result.links])
          )
        }
      : null
  );
  const inspectorView = $derived.by(() => {
    if (!inComposition || !selectedCompositionModel || !composition) return view;
    const entry = composition.state.projects.find(
      (project) => project.model === selectedCompositionModel
    );
    if (!entry) return view;
    return {
      ...entry.view,
      theme: composition.state.theme,
      layout: composition.state.layout
    } satisfies ViewState;
  });
  const inspectorSelected = $derived.by(() => {
    if (inComposition && compositionSelection) {
      if (compositionSelection.kind === 'element') return compositionSelection.element;
      if (compositionSelection.kind === 'relationship') return compositionSelection.relationship;
      if (compositionSelection.kind === 'connection') return compositionSelection.connectionId;
      return '';
    }
    return selected ?? '';
  });
  const inspectorSelectedType = $derived.by(() => {
    if (!inComposition || !compositionSelection) return selectedType;
    if (compositionSelection.kind === 'connection') return 'connection' as const;
    if (compositionSelection.kind === 'relationship') return 'relationship' as const;
    return 'element' as const;
  });
  const inspectorActive = $derived(
    inComposition ? compositionSelection !== null : selected !== null
  );
  async function selectInOutline(id: string) {
    if (composition && selectedCompositionModel) {
      compositionSelection = { kind: 'element', model: selectedCompositionModel, element: id };
      menuOpen = false;
      await tick();
      composedCanvas?.revealElement(selectedCompositionModel, id);
      return;
    }
    select(id, 'element');
    menuOpen = false;
    await tick();
    requestAnimationFrame(() => canvas?.reveal(id));
  }
  async function goOut(id: string | null) {
    if (!model) return;
    const next = outwardView(model, view, id);
    selected = null;
    let rendered: number | undefined = requestId;
    if (next.state !== view) {
      view = next.state;
      sceneId = null;
      rendered = await renderView();
    }
    if (next.target) {
      await tick();
      if (rendered === requestId) canvas?.reveal(next.target);
    }
  }
  let renderedSceneId: string | null = null;
  let requestId = 0;
  let modelRequestId = 0;
  let toastTimer: ReturnType<typeof setTimeout>;
  let initialView: ViewState | null = null;
  /** What the inspector was open on when the link was made; restored once the view renders. */
  let initialSelection: string | null = null;
  /** A theme carried in from another surface wins once, then saved scenes decide again. */
  let initialTheme: ViewState['theme'] | null = null;
  $effect(() => {
    if (!busy) {
      slow = false;
      return;
    }
    const timer = setTimeout(() => (slow = true), SLOW_REQUEST_MS);
    return () => clearTimeout(timer);
  });
  const theme = $derived(
    getTheme(
      isThemeId(composition?.state.theme ?? view.theme)
        ? (composition?.state.theme ?? view.theme)
        : undefined
    )
  );
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
  function chooseTheme(id: string) {
    if (!isThemeId(id)) return;
    if (composition) {
      void renderComposition(parseCompositionState({ ...composition.state, theme: id }));
      return;
    }
    view = { ...view, theme: id };
    renderView();
  }
  const activeScene = $derived(model?.scenes.find((s) => s.id === sceneId));
  const breadcrumbScene = $derived(model?.scenes.find((s) => s.id === sceneAnchor));
  const scopePath = $derived.by(() => {
    if (!model || !view.scope) return [];
    const result = [];
    let current = model.elements.find((element) => element.id === view.scope);
    while (current) {
      result.unshift(current);
      current = current.parent
        ? model.elements.find((element) => element.id === current?.parent)
        : undefined;
    }
    return result;
  });
  const sceneIndex = $derived(
    Math.max(0, model?.scenes.findIndex((s) => s.id === sceneAnchor) ?? 0)
  );
  const tree = $derived(diagram?.nodes ?? []);
  const title = $derived(activeScene?.title ?? 'Custom perspective');
  const subtitle = $derived(activeScene?.description ?? 'A focused view of the same architecture.');

  async function readJson(response: Response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
    return data;
  }
  function announce(message: string) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3200);
  }
  function updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set('model', modelId);
    if (composition) {
      try {
        const next = { ...composition.state };
        if (compositionSelection) next.selection = compositionSelection;
        else delete next.selection;
        compositionStateToUrl(parseCompositionState(next), url.searchParams);
      } catch {
        // An oversized composition still renders; it just cannot round-trip through the URL.
      }
      url.searchParams.delete('view');
      url.searchParams.delete('scene');
      url.searchParams.delete('selected');
    } else {
      url.searchParams.delete(COMPOSITION_URL_PARAM);
      url.searchParams.set('view', JSON.stringify(view));
      if (sceneId) url.searchParams.set('scene', sceneId);
      else url.searchParams.delete('scene');
      // The selection rides beside the view, so a refresh or a copied link reopens the inspector
      // on the same thing. Its type is inferred again from the rendered diagram.
      if (selected) url.searchParams.set('selected', selected);
      else url.searchParams.delete('selected');
    }
    replaceState(url, {});
  }
  $effect(() => {
    void selected;
    void composition;
    void compositionSelection;
    if (diagram || composition) untrack(updateUrl);
  });
  /** What a remembered selection is in this diagram, or null when the view no longer shows it. */
  function selectionType(id: string, rendered: Diagram) {
    if (id === OUTSIDE) return rendered.outside?.length ? 'outside' : null;
    if (rendered.edges.some((e) => e.id === id)) return 'relationship';
    return rendered.nodes.some((n) => n.id === id) ? 'element' : null;
  }
  async function renderView(followId?: string) {
    const token = ++requestId;
    busy = true;
    error = '';
    try {
      const next = await readJson(
        await fetch('/api/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: modelId, state: view, revision })
        })
      );
      if (token !== requestId) return;
      diagram = next;
      if (initialSelection) {
        const type = selectionType(initialSelection, next);
        if (type) select(initialSelection, type);
        initialSelection = null;
      }
      if (followId && diagram) canvas?.followOnLayout(diagram, followId);
      renderedSceneId = sceneId;
      renderedSceneAnchor = sceneAnchor;
      if (
        selected &&
        selectedType !== 'outside' &&
        !next.nodes.some((n: { id: string }) => n.id === selected) &&
        !next.edges.some((e: { id: string }) => e.id === selected)
      )
        selected = null;
      updateUrl();
      return token;
    } catch (e) {
      if (token === requestId) {
        error = e instanceof Error ? e.message : String(e);
        if (diagram) {
          view = { ...diagram.state };
          sceneId = renderedSceneId;
          sceneAnchor = renderedSceneAnchor;
        }
      }
    } finally {
      if (token === requestId) busy = false;
    }
  }
  /**
   * `preloaded` is a request for this same model that was already in flight — on page open the
   * model named in the link does not have to wait for the catalog to come back. Everything else,
   * including how a failure is reported, is unchanged: the response is read here as always.
   */
  async function changeModel(
    id: string,
    requestedScene: string | null = null,
    preloaded: Promise<Response> | null = null
  ) {
    const token = ++modelRequestId;
    ++requestId;
    if (composition) {
      composition = null;
      compositionSelection = null;
      compositionModels = {};
      compositionLinks = {};
      authoredLinks = null;
      authoredLinksModel = '';
      revisionNotice = null;
    }
    busy = true;
    error = '';
    selected = null;
    diagram = null;
    model = null;
    journeys = [];
    source = '';
    revision = '';
    diagramKey?.close();
    try {
      const result = await readJson(
        await (preloaded ?? fetch(`/api/models/${encodeURIComponent(id)}`))
      );
      if (token !== modelRequestId) return;
      model = result.model;
      journeys = result.sequences ?? [];
      source = result.source;
      revision = result.revision;
      modelId = id;
      const scene = model?.scenes.find((s) => s.id === requestedScene) || model!.scenes[0];
      sceneId = initialView && !requestedScene ? null : scene.id;
      sceneAnchor = scene.id;
      view = initialView ?? {
        expanded: [...scene.expanded],
        proposed: scene.proposed,
        lens: scene.lens,
        theme: initialTheme ?? scene.theme ?? view.theme,
        ...(scene.scope ? { scope: scene.scope } : {}),
        ...(scene.layout ? { layout: scene.layout } : {})
      };
      initialView = null;
      initialTheme = null;
      const rendered = await renderView();
      if (rendered === requestId) {
        rememberLastProject(id);
        await tick();
        document.querySelector<SVGSVGElement>('.canvas > svg')?.focus({ preventScroll: true });
      }
    } catch (e) {
      if (token === modelRequestId) {
        error = e instanceof Error ? e.message : String(e);
        busy = false;
      }
    }
  }
  /** Authored links for the current root, loaded once per model when the inspector needs them. */
  async function ensureLinks(target = modelId) {
    if (!target) return;
    if (target === modelId && authoredLinksModel === modelId && authoredLinks) return;
    if (compositionLinks[target]) return;
    try {
      const result: LinksResult = await readJson(
        await fetch(`/api/composition/links?model=${encodeURIComponent(target)}`)
      );
      compositionLinks = { ...compositionLinks, [target]: result };
      if (target === modelId) {
        authoredLinks = result;
        authoredLinksModel = modelId;
      }
    } catch {
      if (target === modelId) {
        authoredLinks = null;
        authoredLinksModel = modelId;
      }
    }
  }
  $effect(() => {
    if (!composition && selectedType === 'element' && selected && model)
      untrack(() => void ensureLinks());
  });
  function snapshotFor(id: string): ProjectSnapshot | null {
    const loaded = compositionModels[id];
    if (!loaded) return null;
    return {
      id,
      model: loaded,
      links: compositionLinks[id]?.links ?? null,
      origins: { elements: {}, relationships: {} },
      revision: composition?.revisions[id] ?? compositionLinks[id]?.revision ?? ''
    };
  }
  function captureAnchor(model: string, kind: 'content' | 'title') {
    if (composedCanvas) {
      const screen =
        kind === 'title'
          ? composedCanvas.screenOfTitle(model)
          : composedCanvas.screenOfContent(model);
      if (screen) return { model, kind, screen: { x: screen.x, y: screen.y }, scale: screen.scale };
    }
    const origin = canvas?.screenOfOrigin();
    if (!origin) return null;
    return {
      model,
      kind: 'content' as const,
      screen: { x: origin.x, y: origin.y },
      scale: origin.scale
    };
  }
  function placeCompositionAnchor() {
    if (!compositionAnchor || !composition || !composedCanvas) return;
    const offset =
      compositionAnchor.kind === 'title'
        ? (composedCanvas.titleOffset(compositionAnchor.model) ?? { x: 0, y: 0 })
        : (composedCanvas.contentOffset(compositionAnchor.model) ?? { x: 0, y: 0 });
    composedCanvas.placeContent({
      offset,
      screen: compositionAnchor.screen,
      scale: compositionAnchor.scale
    });
  }
  function selectionSurvives(composed: ComposedDiagram, value: QualifiedSelection): boolean {
    if (value.kind === 'connection')
      return composed.bridges.some(
        (bridge) =>
          (bridge.owner === value.ownerModel && bridge.id === value.connectionId) ||
          bridge.underlying.some(
            (entry) => entry.owner === value.ownerModel && entry.connectionId === value.connectionId
          )
      );
    return composed.projects.some((project) => project.model === value.model);
  }
  async function renderComposition(next: CompositionState, options: { reload?: boolean } = {}) {
    const generation = nextGeneration(compositionGeneration);
    compositionGeneration = generation;
    const token = ++compositionRequestId;
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/composition/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          root: modelId,
          state: next,
          revisions: options.reload ? {} : (composition?.revisions ?? {}),
          generation,
          ...(options.reload ? { reload: true } : {})
        })
      });
      const payload = await response.json();
      if (token !== compositionRequestId) return;
      if (
        typeof payload.generation === 'number' &&
        isStale(payload.generation, compositionGeneration)
      )
        return;
      if (response.status === 409 && payload.code === 'revision_changed') {
        revisionNotice = {
          kind: 'revision_changed',
          model: payload.model,
          message: `Sources changed${payload.model ? `: ${payload.model}` : ''}`
        };
        return;
      }
      if (response.status === 409 && payload.code === 'source_changing') {
        revisionNotice = {
          kind: 'source_changing',
          model: payload.model,
          message: `${payload.model ?? 'A source'} is changing. Retry the load.`
        };
        return;
      }
      if (response.status === 422 && payload.code === 'budget_exceeded') {
        revisionNotice = {
          kind: 'budget_exceeded',
          message: payload.error ?? 'This composition exceeds its resource budget.'
        };
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      const changing = (payload.composed?.diagnostics ?? []).find(
        (diagnostic: { code: string }) => diagnostic.code === 'source_changing'
      );
      if (changing && composition) {
        revisionNotice = {
          kind: 'source_changing',
          model: changing.target?.model ?? changing.ownerModel,
          message: `${changing.target?.model ?? changing.ownerModel} is changing. Retry the load.`
        };
        return;
      }
      revisionNotice = null;
      composition = {
        state: payload.state,
        composed: payload.composed,
        revisions: payload.revisions
      };
      if (compositionSelection && !selectionSurvives(payload.composed, compositionSelection))
        compositionSelection = null;
      await tick();
      if (compositionAnchor) {
        placeCompositionAnchor();
        compositionAnchor = null;
      }
    } catch (e) {
      if (token === compositionRequestId) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (token === compositionRequestId) busy = false;
    }
  }
  function reloadComposition() {
    if (!composition) return;
    revisionNotice = null;
    void renderComposition(composition.state, { reload: true });
  }
  /**
   * Reveal the linked project beside the root at the reader's current scale. Nothing foreign is
   * fetched until this runs; a repeated activation pans to the frame that already exists.
   */
  async function loadProjectModel(id: string): Promise<Model | null> {
    if (compositionModels[id]) return compositionModels[id];
    try {
      const loaded = await readJson(await fetch(`/api/models/${encodeURIComponent(id)}`));
      compositionModels = { ...compositionModels, [id]: loaded.model };
      await ensureLinks(id);
      return loaded.model as Model;
    } catch {
      return null;
    }
  }
  async function openLink(link: DiagramLink) {
    if (!model) return;
    await ensureLinks();
    if (composition?.state.projects.some((project) => project.model === link.target.model)) {
      compositionSelection = null;
      await tick();
      composedCanvas?.revealProject(link.target.model);
      return;
    }
    const sourceModel = selectedCompositionModel ?? modelId;
    if (composition) compositionAnchor = captureAnchor(sourceModel, 'title');
    else {
      const origin = canvas?.screenOfOrigin();
      compositionAnchor = origin
        ? {
            model: modelId,
            kind: 'content',
            screen: { x: origin.x, y: origin.y },
            scale: origin.scale
          }
        : null;
    }
    let state = composition?.state;
    if (!state) {
      if (!authoredLinks) return;
      const rootSnapshot = {
        id: modelId,
        model,
        links: authoredLinks.links,
        origins: { elements: {}, relationships: {} },
        revision: authoredLinks.revision
      };
      // Start from the scene defaults, then keep exactly what the reader is looking at: the root's
      // local diagram must not change just because it gained a frame.
      state = parseCompositionState({
        ...rootState(rootSnapshot, {
          scene: sceneId ?? undefined,
          theme: view.theme,
          layout: view.layout
        }),
        projects: [
          {
            model: modelId,
            ...(sceneId === null ? {} : { scene: sceneId }),
            mode: 'open' as const,
            view: {
              expanded: [...view.expanded],
              proposed: view.proposed,
              lens: view.lens,
              ...(view.scope === undefined ? {} : { scope: view.scope })
            }
          }
        ]
      });
      compositionModels = { ...compositionModels, [modelId]: model };
      if (authoredLinks) compositionLinks = { ...compositionLinks, [modelId]: authoredLinks };
    }
    const ownerLinks = compositionLinks[sourceModel] ?? authoredLinks;
    const resolution = ownerLinks?.resolution.find((entry) => entry.model === link.target.model);
    if (resolution?.status === 'resolved' || !resolution) {
      const loaded = await loadProjectModel(link.target.model);
      const snapshot = snapshotFor(link.target.model);
      if (loaded && snapshot) state = openProject(state, snapshot, link.target.scene);
    }
    if (!state.projects.some((project) => project.model === link.target.model))
      state = parseCompositionState({
        ...state,
        projects: [
          ...state.projects,
          {
            model: link.target.model,
            mode: 'open',
            view: { expanded: [], proposed: false, lens: 'structure' }
          }
        ]
      });
    compositionSelection = null;
    await renderComposition(state);
  }
  function closeComposition() {
    composition = null;
    compositionSelection = null;
    compositionModels = {};
    compositionLinks = {};
    revisionNotice = null;
  }
  async function restoreComposition(state: CompositionState) {
    if (!model) return;
    compositionModels = { ...compositionModels, [modelId]: model };
    await ensureLinks(modelId);
    for (const project of state.projects) {
      if (project.model === modelId) continue;
      await loadProjectModel(project.model);
    }
    if (state.selection) compositionSelection = state.selection;
    await renderComposition(state, { reload: true });
    await tick();
    if (state.selection?.kind === 'element')
      composedCanvas?.revealElement(state.selection.model, state.selection.element);
    else if (state.selection?.kind === 'connection')
      composedCanvas?.revealProject(state.selection.ownerModel);
  }
  function selectComposition(next: QualifiedSelection) {
    compositionSelection = next;
  }
  function toggleCompositionElement(projectModel: string, id: string) {
    if (!composition) return;
    const entry = composition.state.projects.find((project) => project.model === projectModel);
    if (!entry) return;
    compositionAnchor = captureAnchor(projectModel, 'title');
    const expanded = entry.view.expanded.includes(id)
      ? entry.view.expanded.filter((candidate) => candidate !== id)
      : [...entry.view.expanded, id];
    void renderComposition(
      parseCompositionState({
        ...composition.state,
        projects: composition.state.projects.map((project) =>
          project.model === projectModel
            ? { ...project, view: { ...project.view, expanded } }
            : project
        )
      })
    );
  }
  function projectAction(target: string, action: ProjectAction) {
    if (!composition) return;
    if (action === 'standalone') {
      window.location.href = `/?model=${encodeURIComponent(target)}`;
      return;
    }
    if (action === 'fit') {
      composedCanvas?.fitProject(target);
      return;
    }
    try {
      compositionAnchor = captureAnchor(target, 'title');
      if (typeof action !== 'string') {
        if (action.kind === 'scene') {
          const snapshot = snapshotFor(target);
          if (!snapshot) return;
          void renderComposition(
            setProjectScene(composition.state, target, action.scene, snapshot)
          );
          return;
        }
        const scoped = setProjectScope(composition.state, target, action.element);
        void renderComposition(
          focusProject(scoped, action.element === undefined ? undefined : target)
        );
        return;
      }
      if (action === 'close') {
        const state = closeProject(composition.state, target);
        if (state.projects.length === 1) closeComposition();
        else void renderComposition(state);
        return;
      }
      void renderComposition(
        setProjectMode(composition.state, target, action === 'collapse' ? 'collapsed' : 'open')
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  function revealPort(port: ComposedPort) {
    if (!composition) return;
    compositionAnchor = captureAnchor(port.reveal.model, 'title');
    const entry = composition.state.projects.find((project) => project.model === port.reveal.model);
    let state = composition.state;
    if (entry?.mode === 'collapsed') state = setProjectMode(state, port.reveal.model, 'open');
    state = setProjectScope(state, port.reveal.model, port.reveal.element);
    compositionSelection = {
      kind: 'element',
      model: port.reveal.model,
      element: port.reveal.element
    };
    void renderComposition(state);
  }
  function linksForSelection(): DiagramLink[] {
    const owner = composition ? selectedCompositionModel : modelId;
    const selectedId =
      composition && compositionSelection?.kind === 'element'
        ? compositionSelection.element
        : selected;
    if (!owner || !selectedId) return [];
    const links = (compositionLinks[owner] ?? authoredLinks)?.links?.links ?? [];
    return links.filter((link) => link.from === selectedId || link.from === undefined);
  }
  onMount(() => {
    mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const params = new URL(location.href).searchParams;
    try {
      if (params.has('view')) initialView = JSON.parse(params.get('view')!);
    } catch {
      initialView = null;
    }
    const requestedTheme = params.get('theme');
    if (!initialView && isThemeId(requestedTheme)) initialTheme = requestedTheme;
    initialSelection = params.get('selected');
    try {
      pendingComposition = compositionStateFromUrl(params);
    } catch (e) {
      pendingComposition = undefined;
      error =
        e instanceof CompositionContractError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Invalid composition link.';
    }
    const requested = params.get('model');
    // A link that names its project can ask for the model while the catalog is still loading.
    // The catalog still decides whether that project exists, and still chooses the project when
    // the link names none, so only this one path starts early.
    const preloaded = requested ? fetch(`/api/models/${encodeURIComponent(requested)}`) : null;
    // Nothing awaits this request when the catalog turns the project down; keep that from
    // surfacing as an unhandled rejection.
    preloaded?.catch(() => {});
    refreshCatalog().then(async (items) => {
      if (!items) {
        busy = false;
        return;
      }
      if (!items.length) {
        error = 'No projects configured. Open the project switcher to refresh your catalog.';
        busy = false;
        return;
      }
      if (requested && !items.some((item) => item.id === requested)) {
        error = `Project "${requested}" is not in the catalog. Choose an available project.`;
        busy = false;
        return;
      }
      const recent = lastProject();
      const id = requested ?? (items.some((item) => item.id === recent) ? recent! : items[0].id);
      await changeModel(id, params.get('scene'), id === requested ? preloaded : null);
      if (pendingComposition && model) {
        const replay = pendingComposition;
        pendingComposition = undefined;
        await restoreComposition(replay);
      }
    });
    return () => {
      clearTimeout(toastTimer);
      clearTimeout(sidebarTimer);
      ++requestId;
      ++modelRequestId;
      ++catalogRequestId;
    };
  });
  async function refreshCatalog() {
    const token = ++catalogRequestId;
    try {
      const items: typeof catalog = await readJson(await fetch('/api/models'));
      if (token !== catalogRequestId) return null;
      catalog = items;
      catalogError = '';
      return items;
    } catch (e) {
      if (token === catalogRequestId) {
        catalog = [];
        catalogError = e instanceof Error ? e.message : String(e);
      }
      return null;
    }
  }
  function switchProject(id: string) {
    modal = null;
    menuOpen = false;
    initialView = null;
    changeModel(id);
  }
  function chooseScene(id: string) {
    const scene = model?.scenes.find((s) => s.id === id);
    if (!scene) return;
    if (composition) {
      closeComposition();
    }
    sceneId = scene.id;
    sceneAnchor = scene.id;
    view = {
      expanded: [...scene.expanded],
      proposed: scene.proposed,
      lens: scene.lens,
      theme: scene.theme ?? view.theme,
      ...(scene.scope ? { scope: scene.scope } : {}),
      ...(scene.layout ? { layout: scene.layout } : {})
    };
    menuOpen = false;
    renderView();
  }
  const allStructure = $derived.by(() => {
    if (!model) return null;
    try {
      return showAllStructure(model, view);
    } catch {
      return null;
    } // renderView owns invalid-view feedback and recovery.
  });
  function showStructure() {
    if (!allStructure) return;
    view = allStructure;
    sceneId = null;
    renderView();
  }
  function toggle(id: string) {
    if (composition && selectedCompositionModel) {
      toggleCompositionElement(selectedCompositionModel, id);
      return;
    }
    view = {
      ...view,
      expanded: view.expanded.includes(id)
        ? view.expanded.filter((e) => e !== id)
        : [...view.expanded, id]
    };
    sceneId = null;
    renderView(id);
  }
  function lens(value: 'structure' | 'trust') {
    view = { ...view, lens: value };
    sceneId = null;
    renderView();
  }
  /**
   * Flow direction is a presentation choice, like the theme beside it: it changes how the same
   * model is arranged, not which parts of it are shown. It is the view's layout engine, so it
   * travels in the link, the export and the API exactly like the theme does, and absent means the
   * default left-to-right engine — every older link keeps its meaning.
   */
  const flowShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'toggle-flow')!;
  let mac = $state(false);
  const flowDown = $derived(view.layout === 'elk-layered-down');
  function toggleFlow() {
    if (composition || !diagram || busy) return;
    view = { ...view, layout: flowDown ? undefined : 'elk-layered-down' };
    sceneId = null;
    renderView();
  }
  function select(id: string, type: 'element' | 'relationship' | 'outside') {
    selected = id;
    selectedType = type;
  }
  async function inspectElement(id: string) {
    if (composition && selectedCompositionModel) {
      compositionSelection = { kind: 'element', model: selectedCompositionModel, element: id };
      await tick();
      composedCanvas?.revealElement(selectedCompositionModel, id);
      return;
    }
    const element = model?.elements.find((e) => e.id === id);
    if (!element) return;
    const expanded = new Set(view.expanded);
    let parent = element.parent;
    if (view.scope && !within(id, view.scope)) view = { ...view, scope: undefined };
    while (parent) {
      expanded.add(parent);
      if (parent === view.scope) break;
      parent = model?.elements.find((e) => e.id === parent)?.parent ?? null;
    }
    selected = id;
    selectedType = 'element';
    view = {
      ...view,
      expanded: [...expanded],
      proposed: view.proposed || element.status === 'proposed'
    };
    sceneId = null;
    const rendered = await renderView();
    await tick();
    if (rendered === requestId) canvas?.reveal(id);
  }
  function within(id: string, scope: string): boolean {
    if (id === scope) return true;
    const p = model?.elements.find((e) => e.id === id)?.parent;
    return p ? within(p, scope) : false;
  }
  function focus(id: string) {
    if (composition && selectedCompositionModel) {
      compositionAnchor = captureAnchor(selectedCompositionModel, 'title');
      compositionSelection = { kind: 'element', model: selectedCompositionModel, element: id };
      void renderComposition(
        focusProject(
          setProjectScope(composition.state, selectedCompositionModel, id),
          selectedCompositionModel
        )
      );
      return;
    }
    view = {
      ...view,
      scope: id,
      expanded: [...new Set([id, ...view.expanded.filter((e) => within(e, id))])]
    };
    sceneId = null;
    selected = null;
    renderView();
  }
  function fullSystem() {
    if (composition && selectedCompositionModel) {
      compositionAnchor = captureAnchor(selectedCompositionModel, 'title');
      void renderComposition(
        focusProject(
          setProjectScope(composition.state, selectedCompositionModel, undefined),
          undefined
        )
      );
      return;
    }
    view = { ...view, scope: undefined };
    sceneId = null;
    selected = null;
    renderView();
  }
  function showDialog(node: HTMLDialogElement) {
    node.showModal();
    return {
      destroy() {
        node.close();
      }
    };
  }
  function advance(delta: number) {
    if (!model) return;
    chooseScene(model.scenes[(sceneIndex + delta + model.scenes.length) % model.scenes.length].id);
  }
  function toggleSidebar() {
    canvas?.clearPeek();
    if (matchMedia('(max-width: 760px)').matches) menuOpen = !menuOpen;
    else {
      sidebarMotion = true;
      sidebarCollapsed = !sidebarCollapsed;
      rememberSidebarCollapsed(sidebarCollapsed);
      clearTimeout(sidebarTimer);
      sidebarTimer = setTimeout(() => (sidebarMotion = false), 340);
    }
  }
  async function togglePresentation() {
    presentation = !presentation;
    selected = null;
    menuOpen = false;
    await tick();
    document.querySelector<SVGSVGElement>('.canvas > svg')?.focus({ preventScroll: true });
  }
  function openNavigation(kind: 'jump' | 'projects' | 'shortcuts') {
    diagramKey?.close();
    if (kind === 'jump' || kind === 'projects') refreshCatalog();
    canvas?.clearPeek();
    modal = kind;
  }
  function compositionSnapshots(): Map<string, ProjectSnapshot> {
    const snapshots = new Map<string, ProjectSnapshot>();
    if (!composition) return snapshots;
    for (const project of composition.state.projects) {
      const snapshot = snapshotFor(project.model);
      if (snapshot) snapshots.set(project.model, snapshot);
    }
    return snapshots;
  }
  function compositionSearch(query: string): CompositionSearchResult[] {
    if (!composition) return [];
    return searchComposition(compositionSnapshots(), composition.state, query);
  }
  async function jumpComposition(result: CompositionSearchResult) {
    modal = null;
    await tick();
    if (result.kind === 'link' && result.target) {
      await openLink({
        id: result.linkId ?? result.id,
        title: result.title,
        target: result.target
      });
      return;
    }
    if (!composition) return;
    if (result.kind === 'scene') {
      const snapshot = snapshotFor(result.model);
      if (!snapshot) return;
      compositionAnchor = captureAnchor(result.model, 'title');
      await renderComposition(
        setProjectScene(composition.state, result.model, result.id, snapshot)
      );
      return;
    }
    const snapshot = snapshotFor(result.model);
    if (!snapshot) return;
    const entry = composition.state.projects.find((project) => project.model === result.model);
    let state = composition.state;
    if (entry?.mode === 'collapsed') state = setProjectMode(state, result.model, 'open');
    if (result.kind === 'element' || result.kind === 'relationship') {
      const hit = {
        id: result.id,
        type: result.kind,
        title: result.title,
        description: result.description
      } as SearchResult;
      const revealed = revealSearchResult(
        snapshot.model,
        {
          expanded: [...(entry?.view.expanded ?? [])],
          proposed: entry?.view.proposed ?? false,
          lens: entry?.view.lens ?? 'structure',
          ...(entry?.view.scope === undefined ? {} : { scope: entry.view.scope }),
          theme: composition.state.theme,
          layout: composition.state.layout
        },
        hit
      );
      state = parseCompositionState({
        ...state,
        projects: state.projects.map((project) =>
          project.model === result.model
            ? {
                ...project,
                view: {
                  ...project.view,
                  expanded: [...revealed.view.expanded],
                  proposed: revealed.view.proposed,
                  ...(revealed.view.scope === undefined
                    ? { scope: undefined }
                    : { scope: revealed.view.scope })
                }
              }
            : project
        )
      });
    }
    compositionAnchor = captureAnchor(result.model, 'title');
    compositionSelection = result.selection;
    await renderComposition(state);
    await tick();
    if (result.selection.kind === 'element')
      composedCanvas?.revealElement(result.selection.model, result.selection.element);
    else composedCanvas?.revealProject(result.model);
  }
  async function jumpTo(result: SearchResult) {
    if (!model) return;
    modal = null;
    await tick();
    if (result.type === 'scene') {
      chooseScene(result.id);
      canvas?.fit();
      return;
    }
    const next = revealSearchResult(model, view, result);
    if (!view.proposed && next.view.proposed)
      announce('Showing proposed components and connections');
    view = next.view;
    sceneId = null;
    selected = null;
    const rendered = await renderView();
    if (rendered !== requestId) return;
    if (result.type === 'element') {
      selected = result.id;
      selectedType = 'element';
    } else {
      selected =
        diagram?.edges.find((e) => e.id === result.id || e.underlying.includes(result.id))?.id ??
        null;
      selectedType = 'relationship';
    }
    const target = selected ?? result.id;
    await tick();
    requestAnimationFrame(() => {
      if (rendered === requestId) canvas?.reveal(target);
    });
  }
  function executeCommand(command: CommandId, target: Element) {
    const toggleControl = target.closest('[data-interactive="toggle"]');
    const node = target.closest('[data-node-id]')?.getAttribute('data-node-id');
    const edge = target.closest('[data-edge-id]')?.getAttribute('data-edge-id');
    switch (command) {
      case 'projects':
        openNavigation('projects');
        break;
      case 'jump':
        openNavigation('jump');
        break;
      case 'info':
        diagramKey?.toggle();
        break;
      case 'help':
        openNavigation('shortcuts');
        break;
      case 'toggle-sidebar':
        if (!presentation) toggleSidebar();
        break;
      case 'toggle-flow':
        toggleFlow();
        break;
      case 'open-linked': {
        const link = linksForSelection()[0];
        if (link) void openLink(link);
        else
          void ensureLinks(selectedCompositionModel ?? modelId).then(() => {
            const first = linksForSelection()[0];
            if (first) void openLink(first);
          });
        break;
      }
      case 'reload-sources':
        if (composition) reloadComposition();
        break;
      case 'toggle-presentation':
        if (diagram) togglePresentation();
        break;
      case 'export':
        if (diagram && !busy) modal = 'export';
        break;
      case 'copy-link':
        copyLink();
        break;
      case 'zoom-in':
        if (composition) composedCanvas?.zoom(1);
        else canvas?.zoom(1);
        break;
      case 'zoom-out':
        if (composition) composedCanvas?.zoom(-1);
        else canvas?.zoom(-1);
        break;
      case 'fit':
        if (composition) composedCanvas?.fit();
        else canvas?.fit();
        break;
      case 'previous-scene':
        advance(-1);
        break;
      case 'next-scene':
        advance(1);
        break;
      case 'move-left':
      case 'move-right':
      case 'move-up':
      case 'move-down':
        if (composition) composedCanvas?.navigate(command.slice(5) as Direction);
        else canvas?.navigate(command.slice(5) as Direction);
        break;
      case 'activate':
        if (edge) select(edge, 'relationship');
        else canvas?.toggleActive();
        break;
      case 'inspect': {
        const port = target.closest('[data-project-port]');
        if (composition && port instanceof Element) {
          const modelName = port.getAttribute('data-project-port');
          const element = port.getAttribute('data-port-element');
          const side = port.getAttribute('data-port-side');
          const found = composition.composed.projects
            .find((project) => project.model === modelName)
            ?.ports.find(
              (candidate) => candidate.reveal.element === element && candidate.side === side
            );
          if (found) revealPort(found);
          break;
        }
        const local = target.closest('[data-project][data-local-id]');
        const localModel = local?.getAttribute('data-project');
        const localId = local?.getAttribute('data-local-id');
        const relation = target.closest('[data-edge-id]')?.getAttribute('data-edge-id');
        if (composition && localModel && localId) {
          if (toggleControl) toggleCompositionElement(localModel, localId);
          else selectComposition({ kind: 'element', model: localModel, element: localId });
          break;
        }
        if (composition && relation?.includes(':')) {
          const [modelName, ...rest] = relation.split(':');
          selectComposition({
            kind: 'relationship',
            model: modelName,
            relationship: rest.join(':')
          });
          break;
        }
        const bridge = target.closest('[data-connection-owner][data-connection-id]');
        if (composition && bridge) {
          selectComposition({
            kind: 'connection',
            ownerModel: bridge.getAttribute('data-connection-owner')!,
            connectionId: bridge.getAttribute('data-connection-id')!
          });
          break;
        }
        if (toggleControl && node) toggle(node);
        else if (edge) select(edge, 'relationship');
        else if (node) select(node, 'element');
        else canvas?.activate();
        break;
      }
      case 'toggle': {
        const local = target.closest('[data-project][data-local-id]');
        const localModel = local?.getAttribute('data-project');
        const localId = local?.getAttribute('data-local-id');
        if (composition && localModel && localId) {
          const source = compositionModels[localModel];
          if (source?.elements.some((element) => element.parent === localId))
            toggleCompositionElement(localModel, localId);
          break;
        }
        if (edge) break;
        if (node && model?.elements.some((e) => e.parent === node)) toggle(node);
        else canvas?.toggleActive();
        break;
      }
      case 'outward':
        if (!edge) canvas?.exitLayer();
        break;
      case 'escape':
        if (composedCanvas?.dismissMenu()) break;
        if (modal) {
          if (!exporting) modal = null;
        } else if (diagramKey?.close()) break;
        else if (canvas?.clearPeek()) break;
        else if (presentation) togglePresentation();
        else if (composition) compositionSelection = null;
        else canvas?.exitLayer();
        break;
    }
  }
  function keydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    const target = e.target as Element;
    const editable = !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
    );
    const interactive = !!target.closest('button, a, summary, [role="tab"]');
    const command = resolveShortcut(e, {
      presentation,
      editable,
      interactive,
      modal: !!modal,
      canvas:
        !!target.closest('.canvas > svg, .composition-canvas > svg') || target === document.body
    });
    if (!command) return;
    e.preventDefault();
    executeCommand(command, target);
  }
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportDiagram(format: 'svg' | 'png' | 'html') {
    exporting = true;
    error = '';
    previewError = '';
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          state: view,
          revision,
          format: format === 'html' ? 'html' : 'svg',
          scene: sceneId ?? sceneAnchor,
          title: `${model?.title} / ${title}`,
          subtitle
        })
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      if (format === 'svg' || format === 'html')
        download(blob, `${modelId}-${sceneId ?? 'custom'}.${format}`);
      else {
        const url = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 3840;
          canvas.height = 2160;
          canvas.getContext('2d')!.drawImage(image, 0, 0, 3840, 2160);
          const png = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('PNG export failed'))),
              'image/png'
            )
          );
          download(png, `${modelId}-${sceneId ?? 'custom'}.png`);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      announce(`${format.toUpperCase()} exported`);
      modal = null;
    } catch (e) {
      previewError = e instanceof Error ? e.message : String(e);
    } finally {
      exporting = false;
    }
  }
  async function copyLink() {
    try {
      updateUrl();
      await navigator.clipboard.writeText(location.href);
      announce('View link copied');
    } catch {
      announce('Copy the URL from your address bar');
    }
  }
  function saveView() {
    download(
      new Blob([JSON.stringify({ version: 1, model: modelId, title, state: view }, null, 2)], {
        type: 'application/json'
      }),
      `${modelId}-view.json`
    );
    announce('View saved as JSON');
  }

  $effect(() => {
    if (modal !== 'export') {
      exportPreview = '';
      return;
    }
    let cancelled = false;
    let url = '';
    previewError = '';
    const body = JSON.stringify({
      model: modelId,
      state: view,
      revision,
      title: `${model?.title} / ${title}`,
      subtitle
    });
    fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.blob();
      })
      .then((blob) => {
        if (!cancelled) {
          url = URL.createObjectURL(blob);
          exportPreview = url;
        }
      })
      .catch((e) => {
        if (!cancelled) previewError = e.message;
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  });
</script>

<svelte:head
  ><title>Fractal · {model?.title ?? 'Architecture studio'}</title><meta
    name="description"
    content="Explore software architecture, compose perspectives, and export beautiful system models."
  /></svelte:head
>
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
        {#if breadcrumbScene}
          <nav class="appbar-breadcrumb" aria-label="Current location">
            <button class="crumb-scene" onclick={() => chooseScene(breadcrumbScene.id)}
              >{breadcrumbScene.title}</button
            >
            {#each scopePath as item, index}
              <ChevronRight size={13} />
              <button
                disabled={index === scopePath.length - 1}
                aria-current={index === scopePath.length - 1 ? 'page' : undefined}
                onclick={() => focus(item.id)}>{item.title}</button
              >
            {/each}
            <span class="appbar-subtitle" title={subtitle}>{subtitle}</span>
          </nav>
        {:else if model}
          <nav class="appbar-breadcrumb" aria-label="Current location">
            <span class="crumb-scene" aria-current="page">{title}</span>
            <span class="appbar-subtitle" title={subtitle}>{subtitle}</span>
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
            title="Copy view link"
            aria-label="Copy view link"
            onclick={copyLink}><Link size={17} /></button
          >
          <button
            class="icon-button"
            title="Keyboard Shortcuts"
            aria-label="Keyboard Shortcuts"
            onclick={() => openNavigation('shortcuts')}><Keyboard size={17} /></button
          >
          <button
            class="icon-button"
            title="Export"
            aria-label="Export"
            disabled={!diagram || busy}
            onclick={() => (modal = 'export')}><Download size={17} /></button
          >
          <button
            class="icon-button flow-button"
            class:flowing-down={flowDown}
            role="switch"
            aria-checked={flowDown}
            aria-label="Flow top to bottom"
            aria-keyshortcuts={shortcutLabel(flowShortcut, mac)}
            disabled={!diagram}
            use:tip={{
              title: 'Flow',
              text: `Lay the diagram out top to bottom instead of left to right. Useful on tall screens, portrait pages and embeds. ${shortcutLabel(flowShortcut, mac)}`
            }}
            onclick={() => toggleFlow()}
            >{#if flowDown}<ArrowDown size={17} />{:else}<ArrowRight size={17} />{/if}</button
          >
          <ThemeMenu theme={theme.id} onchoose={chooseTheme} />
          <button
            class="icon-button present-button"
            title="Present"
            aria-label="Present"
            disabled={!diagram}
            onclick={togglePresentation}><Play size={15} /></button
          >
          {#if composition}
            <button
              class="icon-button"
              title="Close linked view"
              aria-label="Close linked view"
              onclick={closeComposition}><X size={17} /></button
            >
          {/if}
          <button
            class="project-switcher"
            aria-label={`Switch project: ${model?.title ?? 'Projects'}`}
            aria-haspopup="dialog"
            onclick={() => openNavigation('projects')}
          >
            <span>{model?.title ?? 'Projects'}</span><ChevronDown size={13} />
          </button>
        </div>
      </header>
      <ModelNavigation
        {model}
        {journeys}
        {modelId}
        {sceneId}
        {selected}
        {menuOpen}
        {sidebarCollapsed}
        {tree}
        {chooseScene}
        lens={view.lens}
        proposed={view.proposed}
        onlens={lens}
        onproposed={(proposed) => {
          if (composition) {
            const target = selectedCompositionModel ?? composition.state.root;
            compositionAnchor = captureAnchor(target, 'title');
            void renderComposition(
              parseCompositionState({
                ...composition.state,
                projects: composition.state.projects.map((project) =>
                  project.model === target
                    ? { ...project, view: { ...project.view, proposed } }
                    : project
                )
              })
            );
            return;
          }
          view = { ...view, proposed };
          sceneId = null;
          renderView();
        }}
        {toggle}
        onshowall={showStructure}
        allShown={allStructure?.expanded.every((id) => view.expanded.includes(id)) ?? true}
        {selectInOutline}
        theme={view.theme}
        expanded={view.expanded}
        clearPeek={() => canvas?.clearPeek()}
        requestPeek={(id, box) => canvas?.requestPeek(id, box)}
        onjump={() => openNavigation('jump')}
        onsource={() => (modal = 'source')}
        onhide={toggleSidebar}
      />
    {/if}
    <main class:with-inspector={!presentation && selected}>
      <div class="composition">
        <div class="composition-heading">
          <div class="composition-title-row">
            <h1 {title}>{title}</h1>
          </div>
          <p title={subtitle}>{subtitle}</p>
        </div>
        <div class="diagram-area" class:loading={slow} aria-busy={busy}>
          {#if model}
            <div class="canvas-layer" class:layer-hidden={composition}>
              {#key model.id}<DiagramCanvas
                  bind:this={canvas}
                  onexitlayer={goOut}
                  oncommandkey={keydown}
                  {diagram}
                  {model}
                  {selected}
                  onselect={select}
                  ontoggle={toggle}
                  {presentation}
                  {measureInsets}
                />{/key}
            </div>
          {/if}
          {#if composition}
            <CompositionCanvas
              bind:this={composedCanvas}
              composed={composition.composed}
              models={compositionModels}
              selection={compositionSelection}
              onselect={selectComposition}
              ontoggle={toggleCompositionElement}
              onprojectaction={projectAction}
              onrevealport={revealPort}
              {measureInsets}
              {presentation}
            />
          {/if}
          {#if model && !composition}<DiagramKey
              bind:this={diagramKey}
              {model}
              {diagram}
              onoutside={() => {
                presentation = false;
                select(OUTSIDE, 'outside');
              }}
            />{/if}
          {#if revisionNotice}
            <div class="revision-banner" data-revision-banner={revisionNotice.kind} role="status">
              <span
                >{revisionNotice.kind === 'revision_changed'
                  ? `Sources changed${revisionNotice.model ? `: ${revisionNotice.model}` : ''}`
                  : revisionNotice.message}</span
              >
              {#if revisionNotice.kind === 'source_changing'}
                <button class="button" data-retry-sources onclick={reloadComposition}>Retry</button>
              {:else if revisionNotice.kind === 'revision_changed'}
                <button class="button" data-reload-sources onclick={reloadComposition}
                  >Reload</button
                >
              {/if}
            </div>
          {/if}
          {#if slow}<div class="loading-badge"><span></span>Composing view</div>{/if}
          {#if !model && !busy && !error}<p class="empty">No model loaded.</p>{/if}
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
      {#if error || catalogError}<div class="error" role="alert">
          {catalogError || error}<button
            class="button"
            onclick={() => {
              initialView = null;
              if (catalogError || !model) openNavigation('projects');
              else chooseScene(model.scenes[0]?.id ?? 'overview');
            }}>{catalogError || !model ? 'Choose project' : 'Reset view'}</button
          >
        </div>{/if}
    </main>
    {#if inspectorActive && inspectorModel && !presentation}
      <InspectorPanel
        model={inspectorModel}
        diagram={inspectorDiagram}
        selected={inspectorSelected}
        selectedType={inspectorSelectedType}
        view={inspectorView}
        composition={inspectorComposition}
        {compositionSelection}
        links={inspectorModel
          ? (compositionLinks[inspectorModel.id] ??
            (inspectorModel.id === modelId ? authoredLinks : null))
          : null}
        {toggle}
        {focus}
        {inspectElement}
        {fullSystem}
        onopenlink={openLink}
        onshowproposed={(id) => {
          if (!composition) return;
          compositionAnchor = captureAnchor(id, 'title');
          void renderComposition(
            parseCompositionState({
              ...composition.state,
              projects: composition.state.projects.map((project) =>
                project.model === id
                  ? { ...project, view: { ...project.view, proposed: true } }
                  : project
              )
            })
          );
        }}
        onclose={() => {
          if (composition) compositionSelection = null;
          else selected = null;
        }}
        onsettled={() => {
          if (composition) return;
          if (selected && !busy && selectedType !== 'outside') canvas?.reveal(selected, true);
        }}
      />
    {/if}
    {#if presentation}<div class="presentation-controls">
        <button aria-label="Previous scene" onclick={() => advance(-1)}
          ><ChevronLeft size={17} /></button
        >
        <div>
          <span>{String(sceneIndex + 1).padStart(2, '0')}</span> / {model?.scenes.length ?? 4}
        </div>
        <button aria-label="Next scene" onclick={() => advance(1)}
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

  {#if modal === 'jump' || modal === 'projects'}<JumpDialog
      {model}
      projects={catalog}
      currentProject={modelId}
      {journeys}
      onsequence={(id) => {
        window.location.href = sequenceLink(modelId, id, view.theme);
      }}
      projectsOnly={modal === 'projects'}
      {catalogError}
      onrefresh={refreshCatalog}
      onproject={switchProject}
      onpick={jumpTo}
      oncomposition={jumpComposition}
      compositionSearch={composition ? compositionSearch : undefined}
      projectTitle={(id) =>
        compositionModels[id]?.title ??
        composition?.composed.projects.find((project) => project.model === id)?.title ??
        id}
      onclose={() => (modal = null)}
    />{/if}
  {#if modal === 'shortcuts'}<ShortcutSheet {presentation} onclose={() => (modal = null)} />{/if}
  {#if modal === 'source' || modal === 'export'}
    <div
      class="modal-backdrop"
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget && !exporting) modal = null;
      }}
    >
      <dialog
        use:showDialog
        class="modal"
        class:source-modal={modal === 'source'}
        oncancel={(e) => {
          e.preventDefault();
          if (!exporting) modal = null;
        }}
        aria-label={modal === 'source' ? 'Model source' : 'Export perspective'}
        tabindex="-1"
      >
        <div class="modal-heading">
          <div>
            <div class="eyebrow">{modal === 'source' ? 'DURABLE MODEL' : 'TAKE IT WITH YOU'}</div>
            <h2>
              {modal === 'source' ? 'Architecture, as text.' : 'Ready for your next conversation.'}
            </h2>
          </div>
          <button
            class="icon-button"
            aria-label="Close dialog"
            disabled={exporting}
            onclick={() => (modal = null)}><X size={18} /></button
          >
        </div>
        {#if modal === 'source'}<p>
            LikeC4 describes the system. Fractal composes the perspective. Edit the local source and
            reload the model to see changes.
          </p>
          <textarea aria-label="LikeC4 model source" readonly value={source} spellcheck="false"
          ></textarea>
          <div class="modal-actions">
            <button
              class="button"
              onclick={() => {
                download(new Blob([source], { type: 'text/plain' }), `${modelId}.c4`);
              }}>Download source</button
            ><button class="button" onclick={saveView}>Save view JSON</button><button
              class="button primary"
              onclick={() => {
                modal = null;
                initialView = { ...view, expanded: [...view.expanded] };
                changeModel(modelId, sceneId);
              }}>Reload model</button
            >
          </div>
        {:else}<p>
            A clean 16:9 composition of <strong>{title}</strong>. Typography, relationships, and
            boundary details travel with it.
          </p>
          <div class="export-preview">
            {#if exportPreview}<img
                src={exportPreview}
                alt={`Export preview of ${title}`}
              />{:else}<span
                >{previewError ? 'Preview unavailable' : 'Composing export preview…'}</span
              >{/if}
          </div>
          <div class="export-options">
            <button disabled={exporting} onclick={() => exportDiagram('html')}
              ><div>
                <strong>Interactive HTML</strong><span
                  >One offline file · full model, perspectives, sequences and sources</span
                >
              </div>
              <Download size={18} /></button
            >
            <button disabled={exporting} onclick={() => exportDiagram('svg')}
              ><div>
                <strong>Vector SVG</strong><span>Scalable artwork for proposals and slides</span>
              </div>
              <Download size={18} /></button
            ><button disabled={exporting} onclick={() => exportDiagram('png')}
              ><div>
                <strong>High-resolution PNG</strong><span
                  >3840 × 2160 · ready to drop into a deck</span
                >
              </div>
              <Download size={18} /></button
            >
          </div>
          {#if previewError}<p class="dialog-error" role="alert">{previewError}</p>{/if}
          <div class="modal-footer">
            {exporting
              ? 'Preparing your export…'
              : 'Editor controls are excluded from the exported artwork.'}
          </div>{/if}
      </dialog>
    </div>
  {/if}
  {#if toast}<div class="toast" role="status"><Check size={15} />{toast}</div>{/if}
</div>
