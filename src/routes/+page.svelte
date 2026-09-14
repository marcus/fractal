<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import DiagramCanvas from '$lib/components/DiagramCanvas.svelte';
  import CompositionCanvas from '$lib/components/CompositionCanvas.svelte';
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
  import { parseCompositionState } from '$lib/composition/parse';
  import { rootState, openProject, closeProject, setProjectMode } from '$lib/composition/state';
  import type {
    ComposedDiagram,
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
  type ProjectAction = 'collapse' | 'reopen' | 'close' | 'standalone' | 'fit';

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
  /** Where the root's local origin sat on screen, so opening a frame leaves it there. */
  let compositionAnchor: { x: number; y: number; scale: number } | null = null;

  let composedCanvas = $state<{
    placeContent: (value: {
      offset: { x: number; y: number };
      screen: { x: number; y: number };
      scale: number;
    }) => void;
    revealProject: (model: string) => void;
    revealElement: (model: string, id: string) => void;
    fit: () => void;
    fitProject: (model: string) => void;
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
      ? { state: composition.state, composed: composition.composed, models: compositionModels }
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
    url.searchParams.set('view', JSON.stringify(view));
    if (sceneId) url.searchParams.set('scene', sceneId);
    else url.searchParams.delete('scene');
    // The selection rides beside the view, so a refresh or a copied link reopens the inspector
    // on the same thing. Its type is inferred again from the rendered diagram.
    if (selected) url.searchParams.set('selected', selected);
    else url.searchParams.delete('selected');
    replaceState(url, {});
  }
  $effect(() => {
    void selected;
    if (diagram) untrack(updateUrl);
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
      authoredLinks = null;
      authoredLinksModel = '';
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
  async function ensureLinks() {
    if (!model || (authoredLinksModel === modelId && authoredLinks)) return;
    try {
      const result: LinksResult = await readJson(
        await fetch(`/api/composition/links?model=${encodeURIComponent(modelId)}`)
      );
      authoredLinks = result;
      authoredLinksModel = modelId;
    } catch {
      authoredLinks = null;
      authoredLinksModel = modelId;
    }
  }
  $effect(() => {
    if (!composition && selectedType === 'element' && selected && model)
      untrack(() => void ensureLinks());
  });
  function placeCompositionAnchor() {
    if (!compositionAnchor || !composition || !composedCanvas) return;
    const root =
      composition.composed.projects.find((project) => project.model === modelId) ??
      composition.composed.projects[0];
    composedCanvas.placeContent({
      offset: { x: root.content.x, y: root.content.y },
      screen: { x: compositionAnchor.x, y: compositionAnchor.y },
      scale: compositionAnchor.scale
    });
  }
  function selectionSurvives(composed: ComposedDiagram, value: QualifiedSelection): boolean {
    if (value.kind === 'connection')
      return composed.bridges.some(
        (bridge) => bridge.owner === value.ownerModel && bridge.id === value.connectionId
      );
    return composed.projects.some((project) => project.model === value.model);
  }
  async function renderComposition(next: CompositionState) {
    const token = ++compositionRequestId;
    busy = true;
    error = '';
    try {
      const result = await readJson(
        await fetch('/api/composition/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            root: modelId,
            state: next,
            revisions: composition?.revisions ?? {}
          })
        })
      );
      if (token !== compositionRequestId) return;
      composition = { state: result.state, composed: result.composed, revisions: result.revisions };
      if (compositionSelection && !selectionSurvives(result.composed, compositionSelection))
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
  /**
   * Reveal the linked project beside the root at the reader's current scale. Nothing foreign is
   * fetched until this runs; a repeated activation pans to the frame that already exists.
   */
  async function openLink(link: DiagramLink) {
    if (!model) return;
    await ensureLinks();
    if (composition?.state.projects.some((project) => project.model === link.target.model)) {
      compositionSelection = null;
      await tick();
      composedCanvas?.revealProject(link.target.model);
      return;
    }
    if (!authoredLinks) return;
    compositionAnchor = canvas?.screenOfOrigin() ?? null;
    const rootSnapshot = {
      id: modelId,
      model,
      links: authoredLinks.links,
      origins: { elements: {}, relationships: {} },
      revision: authoredLinks.revision
    };
    // Start from the scene defaults, then keep exactly what the reader is looking at: the root's
    // local diagram must not change just because it gained a frame.
    let state = parseCompositionState({
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
    const nextModels: Record<string, Model> = { ...compositionModels, [modelId]: model };
    const resolution = authoredLinks.resolution.find((entry) => entry.model === link.target.model);
    if (resolution?.status === 'resolved') {
      try {
        const loaded = await readJson(
          await fetch(`/api/models/${encodeURIComponent(link.target.model)}`)
        );
        state = openProject(
          state,
          {
            id: link.target.model,
            model: loaded.model,
            links: null,
            origins: { elements: {}, relationships: {} },
            revision: loaded.revision
          },
          link.target.scene
        );
        nextModels[link.target.model] = loaded.model;
      } catch {
        // An unresolved or malformed target stays a project entry, so compose can report it.
      }
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
    compositionModels = nextModels;
    compositionSelection = null;
    await renderComposition(state);
  }
  function closeComposition() {
    composition = null;
    compositionSelection = null;
    compositionModels = {};
  }
  function selectComposition(next: QualifiedSelection) {
    compositionSelection = next;
  }
  function toggleCompositionElement(projectModel: string, id: string) {
    if (!composition) return;
    const entry = composition.state.projects.find((project) => project.model === projectModel);
    if (!entry) return;
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
  function linksForSelection(): DiagramLink[] {
    if (!authoredLinks || selectedType !== 'element' || !selected) return [];
    return (authoredLinks.links?.links ?? []).filter(
      (link) => link.from === selected || link.from === undefined
    );
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
      composition = null;
      compositionSelection = null;
      compositionModels = {};
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
      compositionSelection = { kind: 'element', model: selectedCompositionModel, element: id };
      void tick().then(() => composedCanvas?.revealElement(selectedCompositionModel!, id));
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
    if (composition) return;
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
        if (composition) break;
        const link = linksForSelection()[0];
        if (link) void openLink(link);
        else
          void ensureLinks().then(() => {
            const first = linksForSelection()[0];
            if (first) void openLink(first);
          });
        break;
      }
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
        canvas?.zoom(1);
        break;
      case 'zoom-out':
        canvas?.zoom(-1);
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
        canvas?.navigate(command.slice(5) as Direction);
        break;
      case 'activate':
        if (edge) select(edge, 'relationship');
        else canvas?.toggleActive();
        break;
      case 'inspect':
        if (toggleControl && node) toggle(node);
        else if (edge) select(edge, 'relationship');
        else if (node) select(node, 'element');
        else canvas?.activate();
        break;
      case 'toggle':
        if (edge) break;
        if (node && model?.elements.some((e) => e.parent === node)) toggle(node);
        else canvas?.toggleActive();
        break;
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
        links={inspectorModel?.id === modelId ? authoredLinks : null}
        {toggle}
        {focus}
        {inspectElement}
        {fullSystem}
        onopenlink={openLink}
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
