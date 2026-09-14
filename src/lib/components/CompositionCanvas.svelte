<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import FitControl from './FitControl.svelte';
  import ProjectFrame from './ProjectFrame.svelte';
  import BridgeEdge from './BridgeEdge.svelte';
  import { roundedEdgeCurve, edgeCurvePath } from '$lib/ui/edge-motion';
  import { COMPOSITION_METRICS } from '$lib/composition/place';
  import { wheelZoomRatio } from '$lib/ui/camera-gestures';
  import { getTheme } from '$lib/core/themes';
  import { ARCHITECTURE_NODE_METRICS as METRICS } from '$lib/core/node-metrics';
  import { kindHint, kindIcon } from '$lib/core/kind-icons';
  import {
    REFERENCE_STUB_BODY_WIDTH,
    referenceStubDetail,
    referenceStubGeometries
  } from '$lib/composition/stubs';
  import {
    isLowZoom,
    overscanRect,
    rectsIntersect,
    routeBounds,
    worldViewFromCamera
  } from './composition-viewport';
  import type {
    ComposedBridge,
    ComposedDiagram,
    ComposedPort,
    QualifiedSelection
  } from '$lib/composition/types';
  import type { LayoutEdge, LayoutNode, Model, Point } from '$lib/core/types';
  import type { Direction } from '$lib/core/navigation';

  type Insets = { left: number; right: number; bottom: number; top: number };
  export type ProjectAction =
    | 'collapse'
    | 'reopen'
    | 'close'
    | 'standalone'
    | 'fit'
    | { kind: 'scene'; scene: string }
    | { kind: 'scope'; element?: string };

  /**
   * The shared camera over a composed diagram. It holds one absolute transform (screen = origin +
   * composed point * scale) rather than fitting the whole world each render, so expanding a project
   * resizes only its own frame and never rescales or moves the reader's existing frames.
   */
  let {
    composed,
    models,
    selection = null,
    onselect,
    ontoggle,
    onprojectaction,
    onrevealport,
    measureInsets = () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    presentation = false,
    dormant = false
  }: {
    composed: ComposedDiagram;
    models: Record<string, Model>;
    selection?: QualifiedSelection | null;
    onselect: (selection: QualifiedSelection) => void;
    ontoggle: (model: string, id: string) => void;
    onprojectaction: (model: string, action: ProjectAction) => void;
    onrevealport?: (port: ComposedPort) => void;
    measureInsets?: () => Insets;
    presentation?: boolean;
    dormant?: boolean;
  } = $props();

  let svg: SVGSVGElement;
  let size = $state({ width: 1000, height: 600 });
  let fitInsets = $state<Insets>({ left: 0, right: 0, top: 0, bottom: 0 });
  let transform = $state({ x: 0, y: 0, scale: 1 });
  let menuModel = $state<string | null>(null);
  let dragging: { x: number; y: number; originX: number; originY: number } | null = null;
  let moved = false;
  const theme = $derived(getTheme(composed.state.theme));
  /** World-space view plus one extra viewport of overscan; pan/zoom only recomputes this. */
  const cullBounds = $derived(overscanRect(worldViewFromCamera(transform, size)));
  const lowZoom = $derived(isLowZoom(transform.scale));
  const stubGeometries = $derived(referenceStubGeometries(composed));

  function childIdsFor(model: string): Set<string> {
    const source = models[model];
    if (!source) return new Set();
    return new Set(
      source.elements.filter((element) => element.parent).map((element) => element.parent!)
    );
  }
  function boundariesFor(model: string, id: string) {
    return (models[model]?.boundaries ?? []).filter((boundary) => boundary.members.includes(id));
  }
  function project(model: string) {
    return composed.projects.find((candidate) => candidate.model === model);
  }
  const menuProject = $derived(menuModel ? project(menuModel) : null);
  const menuScenes = $derived(menuModel ? (models[menuModel]?.scenes ?? []) : []);
  const menuEntry = $derived(
    menuModel ? composed.state.projects.find((candidate) => candidate.model === menuModel) : null
  );
  const menuFocusElement = $derived.by(() => {
    if (!menuModel || selection?.kind !== 'element' || selection.model !== menuModel) return null;
    return models[menuModel]?.elements.find((element) => element.id === selection.element) ?? null;
  });

  export function fit() {
    menuModel = null;
    fitInsets = measureInsets();
    const width = Math.max(240, size.width - fitInsets.left - fitInsets.right);
    const height = Math.max(240, size.height - fitInsets.top - fitInsets.bottom);
    const scale = Math.min(width / (composed.width + 96), height / (composed.height + 96));
    transform = {
      scale,
      x: fitInsets.left + (width - composed.width * scale) / 2,
      y: fitInsets.top + (height - composed.height * scale) / 2
    };
  }

  /** Map a composed point's old screen position and scale onto its new composed coordinates. */
  export function placeContent({
    offset,
    screen,
    scale
  }: {
    offset: Point;
    screen: Point;
    scale: number;
  }) {
    transform = { scale, x: screen.x - offset.x * scale, y: screen.y - offset.y * scale };
  }

  function ensureVisible(rect: { x: number; y: number; width: number; height: number }) {
    const live = measureInsets();
    const minX = live.left + 32,
      maxX = size.width - live.right - 32,
      minY = live.top + 32,
      maxY = size.height - live.bottom - 32;
    const scale = transform.scale;
    const left = transform.x + rect.x * scale;
    const top = transform.y + rect.y * scale;
    let dx = 0;
    let dy = 0;
    if (left < minX) dx = minX - left;
    else if (left + rect.width * scale > maxX) dx = maxX - (left + rect.width * scale);
    if (top < minY) dy = minY - top;
    else if (top + rect.height * scale > maxY) dy = maxY - (top + rect.height * scale);
    if (dx || dy) transform = { ...transform, x: transform.x + dx, y: transform.y + dy };
  }

  /** Fit one project's frame to the canvas without touching the other frames. */
  export function fitProject(model: string) {
    const target = project(model);
    if (!target) return;
    menuModel = null;
    fitInsets = measureInsets();
    const width = Math.max(240, size.width - fitInsets.left - fitInsets.right);
    const height = Math.max(240, size.height - fitInsets.top - fitInsets.bottom);
    const scale = Math.min(width / (target.frame.width + 96), height / (target.frame.height + 96));
    transform = {
      scale,
      x: fitInsets.left + (width - target.frame.width * scale) / 2 - target.frame.x * scale,
      y: fitInsets.top + (height - target.frame.height * scale) / 2 - target.frame.y * scale
    };
  }

  function initialProject(): string {
    const selectedModel =
      selection?.kind === 'connection' ? selection.ownerModel : selection?.model;
    return project(selectedModel ?? '')?.model ?? composed.state.root;
  }

  export function revealProject(model: string) {
    const target = project(model);
    if (target) ensureVisible(target.frame);
  }

  export function revealElement(model: string, id: string) {
    const target = project(model);
    const node = target?.diagram?.nodes.find((candidate) => candidate.id === id);
    if (!target || !node) return revealProject(model);
    ensureVisible({
      x: target.content.x + node.x,
      y: target.content.y + node.y,
      width: node.width,
      height: node.height
    });
  }

  /** Screen position of a composed point at the current camera, used to keep a title in place. */
  export function screenOf(point: Point) {
    return {
      x: transform.x + point.x * transform.scale,
      y: transform.y + point.y * transform.scale,
      scale: transform.scale
    };
  }

  export function zoom(direction: number) {
    const next = Math.max(0.05, Math.min(8, transform.scale * (direction > 0 ? 1.2 : 1 / 1.2)));
    const px = size.width / 2;
    const py = size.height / 2;
    const ratio = next / transform.scale;
    transform = {
      scale: next,
      x: px - (px - transform.x) * ratio,
      y: py - (py - transform.y) * ratio
    };
  }

  function titlePoint(target: NonNullable<ReturnType<typeof project>>): Point {
    return {
      x: target.frame.x + COMPOSITION_METRICS.padding + 44 + 8,
      y: target.frame.y + COMPOSITION_METRICS.titleClearance
    };
  }

  export function screenOfTitle(model: string) {
    const target = project(model);
    return target ? screenOf(titlePoint(target)) : null;
  }

  export function titleOffset(model: string) {
    const target = project(model);
    return target ? titlePoint(target) : null;
  }

  export function contentOffset(model: string) {
    const target = project(model);
    return target ? { x: target.content.x, y: target.content.y } : null;
  }

  export function screenOfContent(model: string) {
    const target = project(model);
    return target ? screenOf({ x: target.content.x, y: target.content.y }) : null;
  }

  function menuAction(action: ProjectAction) {
    if (!menuProject) return;
    const target = menuProject.model;
    menuModel = null;
    onprojectaction(target, action);
  }

  interface NavTarget {
    key: string;
    x: number;
    y: number;
    focus: () => void;
  }

  function composedTargets(): NavTarget[] {
    const targets: NavTarget[] = [];
    for (const entry of composed.projects) {
      if (entry.diagram) {
        for (const node of entry.diagram.nodes) {
          targets.push({
            key: `element:${entry.model}:${node.id}`,
            x: entry.content.x + node.x + node.width / 2,
            y: entry.content.y + node.y + (node.expanded ? 28 : node.height / 2),
            focus: () => {
              ensureVisible({
                x: entry.content.x + node.x,
                y: entry.content.y + node.y,
                width: node.width,
                height: node.height
              });
              onselect({ kind: 'element', model: entry.model, element: node.id });
              void focusMounted(
                `[data-project="${CSS.escape(entry.model)}"][data-local-id="${CSS.escape(node.id)}"]`
              );
            }
          });
        }
      }
      for (const port of entry.ports) {
        targets.push({
          key: `port:${entry.model}:${port.side}:${port.reveal.element}`,
          x: port.point.x,
          y: port.point.y,
          focus: () => {
            const el = svg.querySelector<SVGGElement>(
              `[data-project-port="${CSS.escape(entry.model)}"][data-port-element="${CSS.escape(port.reveal.element)}"][data-port-side="${port.side}"]`
            );
            el?.focus({ preventScroll: true });
          }
        });
      }
    }
    for (const bridge of composed.bridges) {
      targets.push({
        key: `bridge:${bridge.owner}:${bridge.id}`,
        x: bridge.label.x,
        y: bridge.label.y,
        focus: () => {
          ensureVisible(routeBounds(bridge.points));
          onselect({ kind: 'connection', ownerModel: bridge.owner, connectionId: bridge.id });
          void focusMounted(
            `[data-connection-owner="${CSS.escape(bridge.owner)}"][data-connection-id="${CSS.escape(bridge.id)}"]`
          );
        }
      });
    }
    return targets;
  }

  function activeNavKey(): string | null {
    const el = document.activeElement;
    if (!(el instanceof Element) || !svg.contains(el)) {
      if (selection?.kind === 'element') return `element:${selection.model}:${selection.element}`;
      if (selection?.kind === 'connection')
        return `bridge:${selection.ownerModel}:${selection.connectionId}`;
      return null;
    }
    const node = el.closest<HTMLElement>('[data-project][data-local-id]');
    if (node)
      return `element:${node.getAttribute('data-project')}:${node.getAttribute('data-local-id')}`;
    const port = el.closest<HTMLElement>('[data-project-port][data-port-element]');
    if (port)
      return `port:${port.getAttribute('data-project-port')}:${port.getAttribute('data-port-side')}:${port.getAttribute('data-port-element')}`;
    const bridge = el.closest<HTMLElement>('[data-connection-owner][data-connection-id]');
    if (bridge)
      return `bridge:${bridge.getAttribute('data-connection-owner')}:${bridge.getAttribute('data-connection-id')}`;
    return null;
  }

  /** Spatial focus across frames, ports and bridges, using composed coordinates. */
  export function navigate(direction: Direction) {
    const targets = composedTargets();
    if (!targets.length) return;
    const currentKey = activeNavKey();
    const start = targets.find((target) => target.key === currentKey);
    if (!start) {
      targets[0].focus();
      return;
    }
    const origin = { x: start.x, y: start.y };
    const ranked = targets
      .filter((target) => target.key !== start.key)
      .map((target) => {
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const forward =
          direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
        const cross = Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
        return { target, forward, cross };
      })
      .filter((candidate) => candidate.forward > 1);
    if (!ranked.length) return;
    ranked.sort(
      (a, b) =>
        a.forward + a.cross * 2 - (b.forward + b.cross * 2) ||
        a.target.key.localeCompare(b.target.key)
    );
    ranked[0].target.focus();
  }
  /** Close an open project menu; returns whether one was open, so Escape can chain outward. */
  export function dismissMenu(): boolean {
    const open = menuModel !== null;
    menuModel = null;
    return open;
  }

  /** A not_loaded stub names its authored target; a failed one explains and guides recovery. */
  function stubDetail(stub: ComposedDiagram['stubs'][number]): string {
    return referenceStubDetail(composed.diagnostics, stub);
  }
  function stubAria(stub: ComposedDiagram['stubs'][number]): string {
    if (stub.state === 'not_loaded')
      return `${stub.title}: diagram not opened. Target ${stub.target.model}.`;
    return `${stub.title}: ${stub.state === 'invalid' ? 'invalid' : 'unavailable'}. ${stubDetail(stub)}`;
  }

  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('[data-interactive="toggle"], [data-interactive="project-menu"]')) return;
    if (target.closest('[data-interactive="project-menu-item"]')) return;
    if (target.closest('[data-interactive="port"]')) return;
    menuModel = null;
    moved = false;
    dragging = {
      x: event.clientX,
      y: event.clientY,
      originX: transform.x,
      originY: transform.y
    };
  }
  function move(event: PointerEvent) {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      moved = true;
      svg.setPointerCapture(event.pointerId);
    }
    transform = { ...transform, x: dragging.originX + dx, y: dragging.originY + dy };
  }
  function up() {
    dragging = null;
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    const box = svg.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    const next = Math.max(0.05, Math.min(8, transform.scale * wheelZoomRatio(event)));
    const ratio = next / transform.scale;
    transform = {
      scale: next,
      x: px - (px - transform.x) * ratio,
      y: py - (py - transform.y) * ratio
    };
  }
  function selectNode(model: string, node: LayoutNode) {
    if (moved) return;
    menuModel = null;
    onselect({ kind: 'element', model, element: node.id });
  }
  function toggleNode(model: string, node: LayoutNode) {
    onselect({ kind: 'element', model, element: node.id });
    ontoggle(model, node.id);
  }
  function selectBridge(bridge: ComposedBridge) {
    menuModel = null;
    onselect({ kind: 'connection', ownerModel: bridge.owner, connectionId: bridge.id });
  }
  function selectedElement(model: string, id: string): boolean {
    return selection?.kind === 'element' && selection.model === model && selection.element === id;
  }
  function selectedRelationship(model: string, id: string): boolean {
    return (
      selection?.kind === 'relationship' &&
      selection.model === model &&
      selection.relationship === id
    );
  }
  function selectedBridge(bridge: ComposedBridge): boolean {
    return (
      selection?.kind === 'connection' &&
      selection.ownerModel === bridge.owner &&
      selection.connectionId === bridge.id
    );
  }
  /**
   * Culling is a drawing choice: selection, inspection and search still see every claim.
   * Outlines, ports and the focused/selected element stay mounted so keyboard restore works.
   */
  function nodeMounted(
    model: string,
    node: LayoutNode,
    content: { x: number; y: number }
  ): boolean {
    if (selectedElement(model, node.id)) return true;
    return rectsIntersect(cullBounds, {
      x: content.x + node.x,
      y: content.y + node.y,
      width: node.width,
      height: node.height
    });
  }
  function edgeMounted(
    model: string,
    edge: LayoutEdge,
    content: { x: number; y: number }
  ): boolean {
    if (selectedRelationship(model, edge.id)) return true;
    const points = edge.points.map((point) => ({
      x: content.x + point.x,
      y: content.y + point.y
    }));
    return rectsIntersect(cullBounds, routeBounds(points));
  }
  function bridgeMounted(bridge: ComposedBridge): boolean {
    if (selectedBridge(bridge)) return true;
    return rectsIntersect(cullBounds, routeBounds([...bridge.points, bridge.label]));
  }
  async function focusMounted(selector: string) {
    const apply = () => svg.querySelector<SVGGElement>(selector)?.focus({ preventScroll: true });
    apply();
    await tick();
    apply();
  }
  let resizeObserver: ResizeObserver | null = null;
  onMount(() => {
    resizeObserver = new ResizeObserver(
      ([entry]) => (size = { width: entry.contentRect.width, height: entry.contentRect.height })
    );
    resizeObserver.observe(svg);
    fitInsets = measureInsets();
    if (composed.projects.length) fitProject(initialProject());
    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });
  onDestroy(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });
</script>

<div
  class="composition-canvas"
  class:presentation
  class:low-zoom-detail={lowZoom}
  data-low-zoom={lowZoom ? 'true' : 'false'}
  data-camera-scale={transform.scale}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <svg
    bind:this={svg}
    aria-label={`${models[composed.state.root]?.title ?? composed.state.root} linked composition`}
    role="application"
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onwheel={wheel}
  >
    <defs>
      <pattern id="composition-dots" width="24" height="24" patternUnits="userSpaceOnUse"
        ><circle cx="1" cy="1" r=".7" fill={theme.canvasDots} /></pattern
      >
      <marker
        id="composition-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
        ><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={theme.edge} stroke-width="1.5" /></marker
      >
      <marker
        id="composition-arrow-selected"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
        ><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={theme.accent} stroke-width="1.5" /></marker
      >
      <marker
        id="composition-arrow-proposed"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
        ><path
          d="M 1 1 L 9 5 L 1 9"
          fill="none"
          stroke={theme.proposed}
          stroke-width="1.5"
        /></marker
      >
      <filter id="composition-shadow" x="-10%" y="-10%" width="120%" height="140%"
        ><feDropShadow
          dx="0"
          dy="3"
          stdDeviation="4"
          flood-color={theme.shadow}
          flood-opacity=".04"
        /></filter
      >
    </defs>
    <rect width="100%" height="100%" fill={theme.canvas} />
    <rect
      width="100%"
      height="100%"
      fill={presentation ? 'transparent' : 'url(#composition-dots)'}
    />
    <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
      {#each composed.projects as entry (entry.model)}
        <ProjectFrame
          project={entry}
          linked={entry.model !== composed.state.root}
          menuOpen={menuModel === entry.model}
          {dormant}
          onmenu={(model) => (menuModel = menuModel === model ? null : model)}
          onrevealport={(port) => onrevealport?.(port)}
        />
      {/each}
      {#each composed.bridges.filter( (bridge) => bridgeMounted(bridge) ) as bridge (`${bridge.owner}/${bridge.id}`)}
        <BridgeEdge {bridge} selected={selectedBridge(bridge)} {dormant} onselect={selectBridge} />
      {/each}
      {#each composed.projects as entry (entry.model)}
        {#if entry.diagram}
          {@const childIds = childIdsFor(entry.model)}
          <g class="project-content" transform={`translate(${entry.content.x} ${entry.content.y})`}>
            {#each entry.diagram.edges.filter( (edge) => edgeMounted(entry.model, edge, entry.content) ) as edge (edge.id)}
              {@const path = edgeCurvePath(roundedEdgeCurve(edge.points))}
              <g
                data-edge-id={`${entry.model}:${edge.id}`}
                role="button"
                tabindex="-1"
                aria-label={`${edge.title}: ${edge.source} to ${edge.target}`}
                onclick={() => {
                  if (!moved)
                    onselect({
                      kind: 'relationship',
                      model: entry.model,
                      relationship: edge.id
                    });
                }}
                onkeydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onselect({
                      kind: 'relationship',
                      model: entry.model,
                      relationship: edge.id
                    });
                  }
                }}
                class="local-edge"
                class:selected={selectedRelationship(entry.model, edge.id)}
              >
                <path d={path} fill="none" stroke="transparent" stroke-width="16" />
                <path
                  d={path}
                  fill="none"
                  stroke={selectedRelationship(entry.model, edge.id)
                    ? theme.accent
                    : edge.status === 'proposed'
                      ? theme.proposed
                      : theme.edge}
                  stroke-width={selectedRelationship(entry.model, edge.id) ? 2.5 : 1.5}
                  stroke-dasharray={edge.status === 'proposed' ? '6 5' : undefined}
                />
              </g>
            {/each}
            {#each entry.diagram.nodes
              .filter((node) => node.expanded && nodeMounted(entry.model, node, entry.content))
              .sort((a, b) => a.depth - b.depth) as node (node.id)}
              <g transform={`translate(${node.x} ${node.y})`}>
                <rect width={node.width} height={node.height} rx="14" fill={theme.group} />
              </g>
            {/each}
            {#each entry.diagram.nodes.filter( (node) => nodeMounted(entry.model, node, entry.content) ) as node (node.id)}
              {@const memberships =
                composed.state.projects.find((candidate) => candidate.model === entry.model)?.view
                  .lens === 'trust'
                  ? boundariesFor(entry.model, node.id)
                  : []}
              <g
                data-interactive="node"
                data-node-id={`${entry.model}:${node.id}`}
                data-project={entry.model}
                data-local-id={node.id}
                role="button"
                tabindex="0"
                aria-label={`${node.title}${childIds.has(node.id) ? (node.expanded ? ', expanded' : ', collapsed') : ''}`}
                transform={`translate(${node.x} ${node.y})`}
                class="node"
                class:selected={selectedElement(entry.model, node.id)}
                onclick={() => selectNode(entry.model, node)}
                ondblclick={() => {
                  if (childIds.has(node.id)) toggleNode(entry.model, node);
                }}
                onkeydown={(event) => {
                  if (event.key === 'Enter')
                    onselect({ kind: 'element', model: entry.model, element: node.id });
                  else if (event.key === ' ' && childIds.has(node.id)) {
                    event.preventDefault();
                    toggleNode(entry.model, node);
                  }
                }}
              >
                {#if node.expanded}<rect
                    width={node.width}
                    height={Math.max(56, 32 + node.titleLines.length * 20)}
                    fill="transparent"
                  />{:else}
                  <rect
                    width={node.width}
                    height={node.height}
                    rx="12"
                    fill={theme.card}
                    stroke={selectedElement(entry.model, node.id) || node.status === 'proposed'
                      ? node.color
                      : theme.border}
                    stroke-width={selectedElement(entry.model, node.id) ? 2 : 1.2}
                    stroke-dasharray={node.status === 'proposed' ? '6 4' : undefined}
                    filter="url(#composition-shadow)"
                  />
                {/if}
                {#each memberships as membership, index}<rect
                    data-boundary-id={membership.id}
                    x={-4 - index * 4}
                    y={-4 - index * 4}
                    width={node.width + 8 + index * 8}
                    height={node.height + 8 + index * 8}
                    rx={16 + index * 4}
                    fill="none"
                    stroke={membership.color}
                    stroke-width="1.5"
                    stroke-dasharray="4 5"
                  />{/each}
                {#each node.titleLines as line, index}<text
                    x={node.expanded ? METRICS.expandedContentX : METRICS.collapsed.contentX}
                    y={(node.expanded ? METRICS.expandedTitleY : METRICS.collapsed.titleY) +
                      index * 20}
                    class="node-title">{line}</text
                  >{/each}
                {#if !node.expanded}{#each node.descriptionLines as line, index}<text
                      x={METRICS.collapsed.contentX}
                      y={METRICS.collapsed.titleY + 3 + node.titleLines.length * 21 + index * 17}
                      class="node-description">{line}</text
                    >{/each}{/if}
                {#if !node.expanded && node.descriptionLines.length}
                  <g class="node-description-skeleton" aria-hidden="true">
                    {#each node.descriptionLines.slice(0, 3) as line, index}
                      <rect
                        x={METRICS.collapsed.contentX}
                        y={METRICS.collapsed.titleY + 7 + node.titleLines.length * 21 + index * 17}
                        width={Math.min(
                          node.width - METRICS.collapsed.contentX * 2,
                          Math.max(42, line.length * 5.5)
                        )}
                        height="6"
                        rx="3"
                      />
                    {/each}
                  </g>
                {/if}
                <g
                  class="kind-icon"
                  data-kind={node.kind}
                  transform={`translate(${node.width - METRICS.toggleRight - METRICS.kindIconSize - (childIds.has(node.id) ? METRICS.toggleSize + METRICS.kindIconGap : 0)} ${METRICS.toggleY + (METRICS.toggleSize - METRICS.kindIconSize) / 2}) scale(${METRICS.kindIconSize / 24})`}
                  color={theme.appearance === 'dark' ? theme.accent : node.color}
                >
                  <title>{node.kindLabel}: {kindHint(node.kind)}</title>
                  <rect width="24" height="24" fill="transparent" />
                  {@html kindIcon(node.kind).markup}
                </g>
                {#if childIds.has(node.id)}
                  <g
                    data-interactive="toggle"
                    role="button"
                    tabindex="0"
                    aria-label={`${node.expanded ? 'Collapse' : 'Expand'} ${node.title}`}
                    transform={`translate(${node.width - 24 - METRICS.toggleRight} ${METRICS.toggleY})`}
                    onclick={(event) => {
                      event.stopPropagation();
                      toggleNode(entry.model, node);
                    }}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleNode(entry.model, node);
                      }
                    }}
                    class="expand-control"
                  >
                    <rect width="24" height="24" rx="5" fill="transparent" /><path
                      d={node.expanded ? 'M 7 12 H 17' : 'M 7 12 H 17 M 12 7 V 17'}
                      stroke={node.color}
                      stroke-width="1.5"
                    />
                  </g>
                {/if}
              </g>
            {/each}
          </g>
        {/if}
      {/each}
      <!-- The bridge echo paints the visible line and label above project content, like
        the composed SVG export, while the interactive bridge below keeps clicks, focus and
        selection. The echo is never interactive, so a bridge crossing a card cannot steal
        that card's clicks. -->
      {#each composed.bridges.filter( (bridge) => bridgeMounted(bridge) ) as bridge (`${bridge.owner}/${bridge.id}`)}
        <BridgeEdge {bridge} selected={selectedBridge(bridge)} onselect={selectBridge} passive />
      {/each}
      {#each composed.stubs as stub (`${stub.owner}/${stub.linkId ?? stub.connectionId ?? ''}`)}
        {@const geometry = stubGeometries.get(stub)!}
        <g
          class="reference-stub"
          data-stub-owner={dormant ? undefined : stub.owner}
          data-stub-target={dormant ? undefined : stub.target.model}
          data-stub-state={dormant ? undefined : stub.state}
          transform={`translate(${geometry.position.x} ${geometry.position.y})`}
          role="group"
          aria-label={stubAria(stub)}
        >
          <rect
            width={geometry.width}
            height={geometry.height}
            rx="12"
            fill={theme.card}
            stroke={theme.border}
          />
          <text x="16" y="26" class="stub-title">{stub.title}</text>
          <text x="16" y="46" class="stub-state">
            {stub.state === 'unavailable'
              ? 'Diagram unavailable'
              : stub.state === 'invalid'
                ? 'Diagram invalid'
                : 'Diagram not opened'}
          </text>
          {#each geometry.detailLines as line, index}<text
              x="16"
              y={66 + index * 14}
              class="stub-message"
              data-stub-detail>{line}</text
            >{/each}
          {#each geometry.guidanceLines as line, index}<text
              x="16"
              y={66 + geometry.detailLines.length * 14 + index * 14}
              class="stub-guidance"
              data-stub-guidance>{line}</text
            >{/each}
          <g class="stub-detail-skeleton" aria-hidden="true">
            {#each [...geometry.detailLines, ...geometry.guidanceLines] as line, index}
              <rect
                x="16"
                y={61 + index * 14}
                width={Math.min(REFERENCE_STUB_BODY_WIDTH, Math.max(42, line.length * 5))}
                height="6"
                rx="3"
              />
            {/each}
          </g>
        </g>
      {/each}
    </g>
  </svg>
  {#if menuProject}
    {@const menuPoint = {
      x: transform.x + (menuProject.frame.x + COMPOSITION_METRICS.padding + 2) * transform.scale,
      y:
        transform.y +
        (menuProject.frame.y + COMPOSITION_METRICS.titleClearance + 30) * transform.scale
    }}
    <div
      class="project-menu"
      role="menu"
      aria-label={`Project options: ${menuProject.title}`}
      style={`left:${menuPoint.x}px;top:${menuPoint.y}px`}
      data-interactive="project-menu-item"
    >
      {#each menuScenes as scene (scene.id)}
        <button
          role="menuitemradio"
          aria-checked={menuEntry?.scene === scene.id}
          onclick={() => menuAction({ kind: 'scene', scene: scene.id })}>{scene.title}</button
        >
      {/each}
      {#if menuFocusElement}
        <button
          role="menuitem"
          onclick={() => menuAction({ kind: 'scope', element: menuFocusElement.id })}
          >Focus {menuFocusElement.title}</button
        >
      {/if}
      {#if menuEntry?.view.scope}
        <button role="menuitem" onclick={() => menuAction({ kind: 'scope' })}>Clear focus</button>
      {/if}
      {#if menuProject.mode === 'collapsed'}
        <button role="menuitem" onclick={() => menuAction('reopen')}>Reopen</button>
      {:else}
        <button role="menuitem" onclick={() => menuAction('collapse')}>Collapse</button>
      {/if}
      <button role="menuitem" onclick={() => menuAction('fit')}>Fit project</button>
      <button role="menuitem" onclick={() => menuAction('standalone')}>Open standalone</button>
      {#if menuProject.model !== composed.state.root}
        <button role="menuitem" onclick={() => menuAction('close')}>Close</button>
      {/if}
    </div>
  {/if}
  {#if !presentation}<FitControl onfit={fit} label="Fit composition" />{/if}
</div>

<style>
  .composition-canvas {
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    width: 100%;
    height: 100%;
    min-height: 260px;
    overflow: hidden;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    font-family: Arial, sans-serif;
  }
  svg:active {
    cursor: grabbing;
  }
  .node,
  .local-edge,
  .expand-control {
    cursor: pointer;
    outline: none;
  }
  .node.selected > rect,
  .node:focus-visible > rect {
    stroke: var(--accent, #267566);
    stroke-width: 3;
  }
  .node-title {
    font-family: 'Inter Variable', Inter, Arial, sans-serif;
    font-size: 14px;
    font-weight: 560;
    letter-spacing: -0.1px;
    fill: var(--text, #243b34);
  }
  .node-description {
    font-size: 12px;
    fill: var(--muted, #69766f);
  }
  .node-description-skeleton {
    display: none;
    fill: var(--border, #d9e0da);
    opacity: 0.9;
    pointer-events: none;
  }
  .stub-detail-skeleton {
    display: none;
    fill: var(--border, #d9e0da);
    opacity: 0.9;
    pointer-events: none;
  }
  .kind-icon {
    opacity: 0.85;
  }
  /* Low zoom hides body copy only. Titles, kind icons and project identity stay. */
  .low-zoom-detail .node-description,
  .low-zoom-detail :global(.bridge-label),
  .low-zoom-detail :global(.project-summary),
  .low-zoom-detail .stub-message,
  .low-zoom-detail .stub-guidance {
    display: none;
  }
  .low-zoom-detail .node-description-skeleton {
    display: block;
  }
  .low-zoom-detail .stub-detail-skeleton {
    display: block;
  }
  .low-zoom-detail :global(.bridge-label-skeleton) {
    display: block;
  }
  .expand-control:hover rect {
    fill: var(--hover, #dbe7e0);
  }
  .reference-stub {
    pointer-events: none;
  }
  .stub-title {
    font-size: 13px;
    font-weight: 600;
    fill: var(--text, #243b34);
  }
  .stub-state {
    font-size: 11px;
    fill: var(--muted, #69766f);
  }
  .stub-message {
    font-size: 10px;
    fill: var(--muted, #69766f);
  }
  .stub-guidance {
    font-size: 10px;
    font-style: italic;
    fill: var(--muted, #69766f);
  }
  .local-edge.selected > path {
    stroke: var(--accent, #267566);
    stroke-width: 2.5;
  }
  .project-menu {
    position: absolute;
    z-index: 6;
    display: grid;
    min-width: 160px;
    padding: 6px;
    border: 1px solid var(--ui-border, #d9dfdb);
    border-radius: 10px;
    background: var(--ui-card, white);
    box-shadow: 0 12px 40px #152d2824;
  }
  .project-menu button {
    border: 0;
    background: none;
    text-align: left;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 7px;
    font-size: 12px;
    color: var(--ui-text, #283d34);
    cursor: pointer;
  }
  .project-menu button:hover,
  .project-menu button:focus-visible {
    background: var(--ui-hover, #edf1ea);
    outline: none;
  }
  .project-menu button[aria-checked='true'] {
    font-weight: 600;
  }
</style>
