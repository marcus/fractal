<script lang="ts">
  import { onMount } from 'svelte';
  import FitControl from './FitControl.svelte';
  import ProjectFrame from './ProjectFrame.svelte';
  import BridgeEdge from './BridgeEdge.svelte';
  import { roundedEdgeCurve, edgeCurvePath } from '$lib/ui/edge-motion';
  import { COMPOSITION_METRICS } from '$lib/composition/place';
  import { wheelZoomRatio } from '$lib/ui/camera-gestures';
  import { getTheme } from '$lib/core/themes';
  import { ARCHITECTURE_NODE_METRICS as METRICS } from '$lib/core/node-metrics';
  import { kindHint, kindIcon } from '$lib/core/kind-icons';
  import type { ComposedBridge, ComposedDiagram, QualifiedSelection } from '$lib/composition/types';
  import type { LayoutNode, Model, Point } from '$lib/core/types';

  type Insets = { left: number; right: number; bottom: number; top: number };
  type ProjectAction = 'collapse' | 'reopen' | 'close' | 'standalone';

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
    measureInsets = () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    presentation = false
  }: {
    composed: ComposedDiagram;
    models: Record<string, Model>;
    selection?: QualifiedSelection | null;
    onselect: (selection: QualifiedSelection) => void;
    ontoggle: (model: string, id: string) => void;
    onprojectaction: (model: string, action: ProjectAction) => void;
    measureInsets?: () => Insets;
    presentation?: boolean;
  } = $props();

  let svg: SVGSVGElement;
  let size = $state({ width: 1000, height: 600 });
  let fitInsets = $state<Insets>({ left: 0, right: 0, top: 0, bottom: 0 });
  let transform = $state({ x: 0, y: 0, scale: 1 });
  let menuModel = $state<string | null>(null);
  let dragging: { x: number; y: number; originX: number; originY: number } | null = null;
  let moved = false;
  const theme = $derived(getTheme(composed.state.theme));

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

  function fit() {
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

  function menuAction(action: ProjectAction) {
    if (!menuProject) return;
    const target = menuProject.model;
    menuModel = null;
    onprojectaction(target, action);
  }
  /** Close an open project menu; returns whether one was open, so Escape can chain outward. */
  export function dismissMenu(): boolean {
    const open = menuModel !== null;
    menuModel = null;
    return open;
  }

  /**
   * An unavailable reference card sits below its anchor rather than in the inter-frame corridor:
   * the card is wider than the gap and must never cover another project's title band or menu.
   */
  function stubPosition(anchor: { model: string; element?: string }): Point {
    const owner = project(anchor.model);
    if (anchor.element && owner?.diagram) {
      const node = owner.diagram.nodes.find((candidate) => candidate.id === anchor.element);
      if (node)
        return { x: owner.content.x + node.x, y: owner.content.y + node.y + node.height + 12 };
    }
    const frame = owner?.frame ?? composed.projects[0].frame;
    return { x: frame.x + frame.width - 236, y: frame.y + frame.height + 16 };
  }
  function stubMessage(stub: ComposedDiagram['stubs'][number]): string {
    return (
      composed.diagnostics.find(
        (diagnostic) =>
          (stub.linkId !== undefined && diagnostic.linkId === stub.linkId) ||
          (stub.connectionId !== undefined && diagnostic.connectionId === stub.connectionId)
      )?.message ?? 'This diagram is not available.'
    );
  }

  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('[data-interactive="toggle"], [data-interactive="project-menu"]')) return;
    if (target.closest('[data-interactive="project-menu-item"]')) return;
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
  function selectedBridge(bridge: ComposedBridge): boolean {
    return (
      selection?.kind === 'connection' &&
      selection.ownerModel === bridge.owner &&
      selection.connectionId === bridge.id
    );
  }
  onMount(() => {
    const observer = new ResizeObserver(
      ([entry]) => (size = { width: entry.contentRect.width, height: entry.contentRect.height })
    );
    observer.observe(svg);
    fitInsets = measureInsets();
    fit();
    return () => observer.disconnect();
  });
</script>

<div class="composition-canvas" class:presentation>
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
          menuOpen={menuModel === entry.model}
          onmenu={(model) => (menuModel = menuModel === model ? null : model)}
        />
      {/each}
      {#each composed.bridges as bridge (`${bridge.owner}/${bridge.id}`)}
        <BridgeEdge {bridge} selected={selectedBridge(bridge)} onselect={selectBridge} />
      {/each}
      {#each composed.projects as entry (entry.model)}
        {#if entry.diagram}
          {@const childIds = childIdsFor(entry.model)}
          <g class="project-content" transform={`translate(${entry.content.x} ${entry.content.y})`}>
            {#each entry.diagram.edges as edge (edge.id)}
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
              >
                <path d={path} fill="none" stroke="transparent" stroke-width="16" />
                <path
                  d={path}
                  fill="none"
                  stroke={edge.status === 'proposed' ? theme.proposed : theme.edge}
                  stroke-width="1.5"
                  stroke-dasharray={edge.status === 'proposed' ? '6 5' : undefined}
                />
              </g>
            {/each}
            {#each entry.diagram.nodes
              .filter((node) => node.expanded)
              .sort((a, b) => a.depth - b.depth) as node (node.id)}
              <g transform={`translate(${node.x} ${node.y})`}>
                <rect width={node.width} height={node.height} rx="14" fill={theme.group} />
              </g>
            {/each}
            {#each entry.diagram.nodes as node (node.id)}
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
      {#each composed.stubs as stub (`${stub.owner}/${stub.linkId ?? stub.connectionId ?? ''}`)}
        {@const position = stubPosition(stub.anchor)}
        <g
          class="reference-stub"
          data-stub-owner={stub.owner}
          data-stub-target={stub.target.model}
          transform={`translate(${position.x} ${position.y})`}
          role="group"
          aria-label={`${stub.title}: ${stub.state === 'unavailable' ? 'unavailable' : stub.state === 'invalid' ? 'invalid' : 'diagram not opened'}`}
        >
          <rect width="236" height="86" rx="12" fill={theme.card} stroke={theme.border} />
          <text x="16" y="28" class="stub-title">{stub.title}</text>
          <text x="16" y="48" class="stub-state">
            {stub.state === 'unavailable'
              ? 'Diagram unavailable'
              : stub.state === 'invalid'
                ? 'Diagram invalid'
                : 'Diagram not opened'}
          </text>
          <text x="16" y="68" class="stub-message">{stubMessage(stub)}</text>
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
      {#if menuProject.mode === 'collapsed'}
        <button role="menuitem" onclick={() => menuAction('reopen')}>Reopen</button>
      {:else}
        <button role="menuitem" onclick={() => menuAction('collapse')}>Collapse</button>
      {/if}
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
  .kind-icon {
    opacity: 0.85;
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
    padding: 8px 10px;
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
</style>
