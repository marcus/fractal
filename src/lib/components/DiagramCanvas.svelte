<script lang="ts">
  import FitControl from './FitControl.svelte';
  import { onMount, untrack } from 'svelte';
  import {
    roundedEdgeCurve,
    prepareEdgeMorph,
    interpolateEdgeCurve,
    edgeCurvePath,
    type EdgeCurve
  } from '$lib/ui/edge-motion';
  import { maximumCanvasZoom } from '$lib/ui/zoom';
  import type { Diagram, Model, LayoutNode, LayoutEdge } from '$lib/core/types';
  import { getTheme } from '$lib/core/themes';
  import { ARCHITECTURE_NODE_METRICS as METRICS } from '$lib/core/node-metrics';
  import { kindHint, kindIcon } from '$lib/core/kind-icons';
  import { tip } from '$lib/ui/tooltip.svelte';
  import { directionalNeighbor, type Direction } from '$lib/core/navigation';
  import { SHORTCUTS, shortcutLabel, shortcutKeys } from '$lib/core/shortcuts';
  import { inspectComponent } from '$lib/core/inspect';
  let {
    diagram,
    model,
    selected,
    onselect,
    ontoggle,
    onexitlayer,
    oncommandkey,
    presentation = false,
    measureInsets = () => ({ left: 0, right: 0, top: 0, bottom: 0 })
  }: {
    diagram: Diagram | null;
    model: Model;
    selected: string | null;
    onselect: (id: string, type: 'element' | 'relationship') => void;
    ontoggle: (id: string) => void;
    onexitlayer: (id: string | null) => void;
    oncommandkey: (e: KeyboardEvent) => void;
    presentation?: boolean;
    measureInsets?: () => Insets;
  } = $props();
  type Insets = { left: number; right: number; top: number; bottom: number };
  const keyboardHelp = $derived(
    SHORTCUTS.filter(
      (command) =>
        command.group === 'Canvas' ||
        command.id === 'help' ||
        command.id === 'escape' ||
        (presentation && command.group === 'Presentation')
    )
      .filter((command) => shortcutKeys(command, presentation ? 'presentation' : 'studio').length)
      .map((command) => {
        const keys = shortcutKeys(command, presentation ? 'presentation' : 'studio');
        const label =
          command.id === 'escape'
            ? presentation
              ? 'Exit presentation'
              : 'Move outward or close preview'
            : command.label;
        return `${label}: ${keys.map((key) => shortcutLabel(key)).join(', ')}.`;
      })
      .join(' ')
  );
  type AnimatedNode = LayoutNode & { opacity: number };
  let nodes = $state.raw<AnimatedNode[]>([]);
  type AnimatedEdge = LayoutEdge & { opacity: number; curve: EdgeCurve; path: string };
  let edges = $state.raw<AnimatedEdge[]>([]);
  let world = $state({ width: 1200, height: 600 });
  let camera = $state({ x: 0, y: 0, zoom: 1 });
  let activeId = $state<string | null>(null);
  let peekId = $state<string | null>(null);
  let peekPosition = $state({ x: 0, y: 0 });
  let peekTimer: ReturnType<typeof setTimeout>;
  let cameraFrame = 0;
  let pendingReveal: string | null = null;
  let pendingFollow: { diagram: Diagram; id: string } | null = null;
  type Follow = { id: string | null; x: number; y: number; scale: number };
  /** While a layout animates, the camera keeps the followed title where `from` says, easing
      toward `to` when a double-click also asked to bring the node close. */
  let following: (Follow & { to?: Omit<Follow, 'id'> }) | null = null;
  /** A double-click on a container while zoomed out: expand it, then bring it close. */
  let approachId: string | null = null;
  /* Below this on-screen scale, text is too small to read and a double-click zooms in first. */
  const READABLE = 0.72;
  let followedId: string | null = null;
  let animating = false;
  export function followOnLayout(diagram: Diagram, id: string) {
    pendingFollow = { diagram, id };
  }
  function titlePosition(node: LayoutNode) {
    return {
      x: node.x + (node.expanded ? METRICS.expandedContentX : METRICS.collapsed.contentX),
      y: node.y + (node.expanded ? METRICS.expandedTitleY : METRICS.collapsed.titleY)
    };
  }
  const peek = $derived(
    peekId && diagram ? inspectComponent(model, peekId, { proposed: diagram.state.proposed }) : null
  );
  export function clearPeek() {
    clearTimeout(peekTimer);
    const shown = !!peekId;
    peekId = null;
    return shown;
  }
  export function requestPeek(id: string, box: DOMRect) {
    clearPeek();
    if (diagram?.state.expanded.includes(id)) return;
    peekTimer = setTimeout(() => {
      const canvas = svg.getBoundingClientRect();
      peekPosition = {
        x: Math.max(12, Math.min(size.width - 300, box.right - canvas.left + 10)),
        y: Math.max(12, Math.min(size.height - 290, box.top - canvas.top))
      };
      peekId = id;
    }, 750);
  }
  export function reveal(id: string, automatic = false) {
    // An inspector opening alongside a double-click must not override expansion's camera.
    if (automatic && followedId === id) return;
    followedId = null;
    following = null;
    activeId = diagram?.nodes.some((n) => n.id === id) ? id : null;
    if (animating) {
      pendingReveal = id;
      return;
    }
    requestAnimationFrame(() => {
      let node: Pick<LayoutNode, 'x' | 'y' | 'width' | 'height'> | undefined = nodes.find(
        (n) => n.id === id
      );
      const edge = edges.find((e) => e.id === id);
      if (!node && edge) {
        const ends = nodes.filter((n) => n.id === edge.source || n.id === edge.target);
        if (ends.length) {
          const x = Math.min(...ends.map((n) => n.x)),
            y = Math.min(...ends.map((n) => n.y));
          node = {
            x,
            y,
            width: Math.max(...ends.map((n) => n.x + n.width)) - x,
            height: Math.max(...ends.map((n) => n.y + n.height)) - y
          };
        }
      }
      if (!node) return;
      const base = fitScale;
      const live = measureInsets();
      const minX = live.left + 32,
        maxX = size.width - live.right - 32,
        minY = live.top + 32,
        maxY = size.height - live.bottom - 32;
      const zoom = Math.min(
        camera.zoom,
        (maxX - minX - 8) / (node.width * base),
        (maxY - minY - 8) / (node.height * base)
      );
      const f = base * zoom;
      const x = fitInsets.left + (fitWidth - world.width * f) / 2 + camera.x + node.x * f;
      const y = fitInsets.top + (fitHeight - world.height * f) / 2 + camera.y + node.y * f;
      const dx = x < minX ? minX - x : x + node.width * f > maxX ? maxX - x - node.width * f : 0;
      const dy = y < minY ? minY - y : y + node.height * f > maxY ? maxY - y - node.height * f : 0;
      const from = { ...camera },
        target = { x: camera.x + dx, y: camera.y + dy, zoom };
      cancelAnimationFrame(cameraFrame);
      const started = performance.now();
      function step(now: number) {
        const p = reduced ? 1 : Math.min(1, (now - started) / 320),
          t = 1 - Math.pow(1 - p, 3);
        camera = {
          x: lerp(from.x, target.x, t),
          y: lerp(from.y, target.y, t),
          zoom: lerp(from.zoom, target.zoom, t)
        };
        if (p < 1) cameraFrame = requestAnimationFrame(step);
      }
      cameraFrame = requestAnimationFrame(step);
      svg
        .querySelector<SVGGElement>(
          `[data-node-id="${CSS.escape(id)}"], [data-edge-id="${CSS.escape(id)}"]`
        )
        ?.focus({ preventScroll: true });
    });
  }
  /**
   * Where a node's title should sit on screen for the node to read at its natural size, or
   * fit the uncovered canvas if it is bigger than that: centered, clear of floating chrome.
   */
  function approachGoal(node: Pick<LayoutNode, 'x' | 'y' | 'width' | 'height' | 'expanded'>) {
    const live = measureInsets();
    const visibleWidth = size.width - live.left - live.right;
    const visibleHeight = size.height - live.top - live.bottom;
    const scale = Math.min(1, (visibleWidth - 72) / node.width, (visibleHeight - 72) / node.height);
    const title = titlePosition(node as LayoutNode);
    const left = live.left + visibleWidth / 2 - (node.width * scale) / 2;
    const top = live.top + visibleHeight / 2 - (node.height * scale) / 2;
    return { x: left + (title.x - node.x) * scale, y: top + (title.y - node.y) * scale, scale };
  }
  function animateCamera(target: { x: number; y: number; zoom: number }) {
    const from = { ...camera };
    cancelAnimationFrame(cameraFrame);
    const started = performance.now();
    function step(now: number) {
      const p = reduced ? 1 : Math.min(1, (now - started) / 360),
        t = 1 - Math.pow(1 - p, 3);
      camera = {
        x: lerp(from.x, target.x, t),
        y: lerp(from.y, target.y, t),
        zoom: lerp(from.zoom, target.zoom, t)
      };
      if (p < 1) cameraFrame = requestAnimationFrame(step);
    }
    cameraFrame = requestAnimationFrame(step);
  }
  /** Bring a node to its natural size, centered, without changing the layout. */
  function approach(id: string) {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    following = null;
    clearPeek();
    const goal = approachGoal(node);
    const title = titlePosition(node);
    animateCamera({
      zoom: goal.scale / fitScale,
      x: goal.x - title.x * goal.scale - fitInsets.left - (fitWidth - world.width * goal.scale) / 2,
      y: goal.y - title.y * goal.scale - fitInsets.top - (fitHeight - world.height * goal.scale) / 2
    });
  }
  /**
   * Double-click expands a container. Zoomed out too far to read, it also brings the node to a
   * readable size: containers grow into the view as they expand, leaves simply come closer.
   */
  function doubleClick(id: string) {
    const zoomedOut = factor < READABLE;
    if (childIds.has(id)) {
      approachId = zoomedOut ? id : null;
      ontoggle(id);
    } else if (zoomedOut) approach(id);
  }
  export function navigate(direction: Direction) {
    clearPeek();
    const id = directionalNeighbor(diagram?.nodes ?? [], activeId ?? selected, direction);
    if (id) reveal(id);
  }
  export function toggleActive() {
    const id = activeId ?? selected;
    if (id && childIds.has(id)) {
      clearPeek();
      ontoggle(id);
    }
  }
  export function zoom(direction: number) {
    clearPeek();
    cancelAnimationFrame(cameraFrame);
    camera = {
      ...camera,
      zoom: boundedZoom(camera.zoom * (direction > 0 ? 1.2 : 1 / 1.2))
    };
    takeCameraControl();
  }
  function takeCameraControl() {
    // Keep the user's new transform stable while the remaining layout frames finish.
    if (following) following = { id: null, x: tx, y: ty, scale: factor };
  }
  function boundedZoom(value: number) {
    // Following may move outside the relative fit limits. Never reverse a zoom gesture.
    return Math.max(
      Math.min(0.35, camera.zoom),
      Math.min(Math.max(maximumZoom, camera.zoom), value)
    );
  }
  export function fit() {
    following = null;
    clearPeek();
    cancelAnimationFrame(cameraFrame);
    fitInsets = measureInsets();
    camera = { x: 0, y: 0, zoom: 1 };
  }
  export function activate() {
    if (activeId) onselect(activeId, 'element');
  }
  export function exitLayer() {
    if (!clearPeek()) onexitlayer(activeId ?? selected);
  }
  let frame = 0;
  let reduced = $state(false);
  let svg: SVGSVGElement;
  let dragging: { x: number; y: number; cameraX: number; cameraY: number } | null = null;
  let moved = false;
  let size = $state({ width: 1000, height: 600 });
  // Floating chrome covers the canvas edges rather than narrowing it. The fit region is captured
  // when the reader fits, never when a panel opens or closes, so chrome changes leave the
  // diagram exactly where it is.
  let fitInsets = $state<Insets>({ left: 0, right: 0, top: 0, bottom: 0 });
  const fitWidth = $derived(Math.max(240, size.width - fitInsets.left - fitInsets.right));
  const fitHeight = $derived(Math.max(240, size.height - fitInsets.top - fitInsets.bottom));
  const fitScale = $derived(
    Math.min(fitWidth / (world.width + 96), fitHeight / (world.height + 96))
  );
  const maximumZoom = $derived(maximumCanvasZoom(fitScale));
  const factor = $derived(fitScale * camera.zoom);
  const tx = $derived(fitInsets.left + (fitWidth - world.width * factor) / 2 + camera.x);
  const ty = $derived(fitInsets.top + (fitHeight - world.height * factor) / 2 + camera.y);
  const theme = $derived(getTheme(diagram?.state.theme));
  const childIds = $derived(new Set(model.elements.filter((e) => e.parent).map((e) => e.parent)));

  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = media.matches;
    const update = () => {
      reduced = media.matches;
    };
    media.addEventListener('change', update);
    const observer = new ResizeObserver(([entry]) => {
      size = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(svg);
    fitInsets = measureInsets();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(cameraFrame);
      clearPeek();
    };
  });

  const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
  function anchor(
    node: LayoutNode,
    candidates: Map<string, LayoutNode>,
    parents: Map<string, string | null>
  ) {
    let parent = node.parent;
    while (parent) {
      const visible = candidates.get(parent);
      if (visible) return visible;
      parent = parents.get(parent) ?? null;
    }
    return node;
  }
  function animate(next: Diagram) {
    cancelAnimationFrame(frame);
    clearPeek();
    animating = true;
    const from = [...nodes];
    const oldEdges = new Map(edges.map((e) => [e.id, e]));
    const fromById = new Map(from.map((n) => [n.id, n]));
    const nextById = new Map(next.nodes.map((n) => [n.id, n]));
    const followed = pendingFollow?.diagram === next ? fromById.get(pendingFollow.id) : null;
    followedId = followed?.id ?? null;
    following = null;
    pendingFollow = null;
    if (followed && nextById.has(followed.id)) {
      cancelAnimationFrame(cameraFrame);
      pendingReveal = null;
      const title = titlePosition(followed);
      following = {
        id: followed.id,
        x: tx + title.x * factor,
        y: ty + title.y * factor,
        scale: factor
      };
      if (approachId === followed.id) following.to = approachGoal(nextById.get(followed.id)!);
    }
    approachId = null;
    const parents = new Map(model.elements.map((e) => [e.id, e.parent ?? null]));
    const fromWorld = { ...world };
    const targetIds = new Set(next.nodes.map((n) => n.id));
    if (activeId && !targetIds.has(activeId)) activeId = null;
    const transitions = next.nodes.map((n) => {
      const existing = fromById.get(n.id);
      const parent = anchor(n, fromById, parents);
      return {
        target: n,
        from: existing ?? {
          ...n,
          x: parent.x + parent.width / 2 - n.width / 2,
          y: parent.y + parent.height / 2 - n.height / 2,
          opacity: 0
        }
      };
    });
    const exiting = from
      .filter((n) => !targetIds.has(n.id))
      .map((n) => ({ from: n, target: anchor(n, nextById, parents) }));
    const edgeTransitions = next.edges.map((edge) => {
      const old = oldEdges.get(edge.id);
      const a = fromById.get(edge.source) ?? anchor(nextById.get(edge.source)!, fromById, parents);
      const b = fromById.get(edge.target) ?? anchor(nextById.get(edge.target)!, fromById, parents);
      const curve = roundedEdgeCurve(edge.points);
      const fromCurve =
        old?.curve ??
        roundedEdgeCurve([
          { x: a.x + a.width, y: a.y + a.height / 2 },
          { x: b.x, y: b.y + b.height / 2 }
        ]);
      return {
        target: { ...edge, opacity: 1, curve, path: edgeCurvePath(curve) },
        morph: prepareEdgeMorph(fromCurve, curve),
        label: old?.label ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        opacity: old?.opacity ?? 0
      };
    });
    const started = performance.now();
    const duration = reduced || !from.length ? 0 : 650;
    function tick(now: number) {
      const p = duration ? Math.min(1, (now - started) / duration) : 1;
      const eased = 1 - Math.pow(1 - p, 3);
      world = {
        width: lerp(fromWorld.width, next.width, eased),
        height: lerp(fromWorld.height, next.height, eased)
      };
      const frameNodes = transitions.map(({ target: n, from: f }) => ({
        ...n,
        x: lerp(f.x, n.x, eased),
        y: lerp(f.y, n.y, eased),
        width: lerp(f.width, n.width, eased),
        height: lerp(f.height, n.height, eased),
        opacity: lerp(f.opacity, 1, eased)
      }));
      if (p < 1)
        frameNodes.push(
          ...exiting.map(({ from: n, target: a }) => ({
            ...n,
            x: lerp(n.x, a.x + a.width / 2 - n.width / 2, eased),
            y: lerp(n.y, a.y + a.height / 2 - n.height / 2, eased),
            opacity: (1 - eased) * n.opacity
          }))
        );
      nodes = frameNodes;
      if (following) {
        const node = frameNodes.find((n) => n.id === following!.id);
        if (node || following.id === null) {
          const title = node ? titlePosition(node) : { x: 0, y: 0 };
          const base = fitScale;
          const goal = following.to
            ? {
                x: lerp(following.x, following.to.x, eased),
                y: lerp(following.y, following.to.y, eased),
                scale: lerp(following.scale, following.to.scale, eased)
              }
            : following;
          // Follow the title, not the growing container's center, at the reader's scale (or on
          // the way to the approach scale).
          const nextCamera = {
            zoom: goal.scale / base,
            x:
              goal.x -
              title.x * goal.scale -
              fitInsets.left -
              (fitWidth - world.width * goal.scale) / 2,
            y:
              goal.y -
              title.y * goal.scale -
              fitInsets.top -
              (fitHeight - world.height * goal.scale) / 2
          };
          if (dragging) {
            dragging.cameraX += nextCamera.x - camera.x;
            dragging.cameraY += nextCamera.y - camera.y;
          }
          camera = nextCamera;
        }
      }
      edges = edgeTransitions.map(({ target, morph, label, opacity }) => {
        if (p === 1) return target;
        const curve = interpolateEdgeCurve(morph, eased);
        return {
          ...target,
          opacity: lerp(opacity, 1, eased),
          curve,
          path: edgeCurvePath(curve),
          label: {
            x: lerp(label.x, target.label.x, eased),
            y: lerp(label.y, target.label.y, eased)
          }
        };
      });
      if (p < 1) frame = requestAnimationFrame(tick);
      else {
        animating = false;
        following = null;
        if (pendingReveal) {
          const id = pendingReveal;
          pendingReveal = null;
          reveal(id);
        }
      }
    }
    frame = requestAnimationFrame(tick);
  }
  $effect(() => {
    if (diagram) {
      const d = diagram;
      untrack(() => animate(d));
    }
  });

  function boundaryFor(id: string) {
    return model.boundaries.filter((b) => b.members.includes(id));
  }
  function down(e: PointerEvent) {
    moved = false;
    clearPeek();
    cancelAnimationFrame(cameraFrame);
    if (e.button !== 0) return;
    // A drag can start anywhere, nodes and labels included; a click still selects when the
    // pointer has not moved. Only the expand control keeps the pointer to itself.
    if ((e.target as Element).closest('[data-interactive="toggle"]')) return;
    takeCameraControl();
    dragging = { x: e.clientX, y: e.clientY, cameraX: camera.x, cameraY: camera.y };
    moved = false;
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    moved = Math.abs(e.clientX - dragging.x) + Math.abs(e.clientY - dragging.y) > 3;
    // Capture only once this is a drag, so a still click keeps its target and selects.
    if (moved) svg.setPointerCapture(e.pointerId);
    camera = {
      ...camera,
      x: dragging.cameraX + e.clientX - dragging.x,
      y: dragging.cameraY + e.clientY - dragging.y
    };
    takeCameraControl();
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    clearPeek();
    cancelAnimationFrame(cameraFrame);
    const zoom = boundedZoom(camera.zoom * Math.exp(-e.deltaY * 0.0015));
    const box = svg.getBoundingClientRect();
    const ox = e.clientX - box.left - (fitInsets.left + fitWidth / 2),
      oy = e.clientY - box.top - (fitInsets.top + fitHeight / 2);
    const ratio = zoom / camera.zoom;
    camera = { zoom, x: ox - (ox - camera.x) * ratio, y: oy - (oy - camera.y) * ratio };
    takeCameraControl();
  }
</script>

<div class="canvas" class:presentation>
  <span id="canvas-help" class="canvas-help">{keyboardHelp}</span>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (This diagram is a keyboard-operated application with spatial focus.) -->
  <svg
    bind:this={svg}
    aria-label={`${model.title} interactive architecture`}
    role="application"
    aria-describedby="canvas-help"
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (dragging = null)}
    onpointercancel={() => (dragging = null)}
    onwheel={wheel}
  >
    <defs>
      <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"
        ><circle cx="1" cy="1" r=".7" fill={theme.canvasDots} /></pattern
      >
      <marker
        id="arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
        ><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={theme.edge} stroke-width="1.5" /></marker
      >
      <marker
        id="arrow-selected"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
        ><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={theme.accent} stroke-width="1.5" /></marker
      >
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="140%"
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
    <rect width="100%" height="100%" fill={presentation ? 'transparent' : 'url(#dots)'} />
    <g transform={`translate(${tx} ${ty}) scale(${factor})`}>
      {#each nodes.filter((n) => n.expanded).sort((a, b) => a.depth - b.depth) as node (node.id)}
        <g transform={`translate(${node.x} ${node.y})`} opacity={node.opacity}>
          <rect
            width={node.width}
            height={node.height}
            rx="14"
            fill={theme.group}
            stroke={selected === node.id || node.status === 'proposed' ? node.color : theme.border}
            stroke-width={selected === node.id ? 2 : 1.2}
            stroke-dasharray={node.status === 'proposed' ? '6 4' : undefined}
          />
        </g>
      {/each}
      {#each edges as edge (edge.id)}
        <g
          opacity={edge.opacity ?? 1}
          data-interactive="edge"
          data-edge-id={edge.id}
          role="button"
          tabindex="0"
          aria-label={`${edge.title}: ${edge.source} to ${edge.target}`}
          onfocus={() => {
            activeId = null;
            clearPeek();
          }}
          onclick={() => {
            activeId = null;
            clearPeek();
            onselect(edge.id, 'relationship');
          }}
          onkeydown={oncommandkey}
          class="edge"
          class:selected={selected === edge.id}
        >
          <path d={edge.path} fill="none" stroke="transparent" stroke-width="16" />
          <path
            d={edge.path}
            fill="none"
            stroke={selected === edge.id
              ? theme.accent
              : edge.status === 'proposed'
                ? theme.proposed
                : theme.edge}
            stroke-width={selected === edge.id ? 2.5 : 1.5}
            stroke-dasharray={edge.status === 'proposed' ? '6 5' : undefined}
            marker-end={selected === edge.id ? 'url(#arrow-selected)' : 'url(#arrow)'}
          />
          <g transform={`translate(${edge.label.x} ${edge.label.y})`}>
            {#each edge.labelLines as line, i}<text
                x="0"
                y={i * 15}
                text-anchor="middle"
                class="edge-label">{line}</text
              >{/each}
          </g>
        </g>
      {/each}
      {#each nodes as node (node.id)}
        {@const memberships = diagram?.state.lens === 'trust' ? boundaryFor(node.id) : []}
        <g
          data-interactive="node"
          data-node-id={node.id}
          role="button"
          tabindex={activeId === node.id ? 0 : -1}
          onfocus={() => (activeId = node.id)}
          aria-label={`${node.title}${childIds.has(node.id) ? (node.expanded ? ', expanded' : ', collapsed') : ''}`}
          transform={`translate(${node.x} ${node.y})`}
          opacity={node.opacity}
          class="node"
          class:presenter-active={presentation && activeId === node.id}
          onclick={() => {
            if (!moved) {
              activeId = node.id;
              onselect(node.id, 'element');
            }
          }}
          ondblclick={() => doubleClick(node.id)}
          onkeydown={oncommandkey}
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
              stroke={selected === node.id || node.status === 'proposed'
                ? node.color
                : theme.border}
              stroke-width={selected === node.id ? 2 : 1.2}
              stroke-dasharray={node.status === 'proposed' ? '6 4' : undefined}
              filter="url(#shadow)"
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
          {#each node.titleLines as line, i}<text
              x={node.expanded ? METRICS.expandedContentX : METRICS.collapsed.contentX}
              y={(node.expanded ? METRICS.expandedTitleY : METRICS.collapsed.titleY) + i * 20}
              class="node-title">{line}</text
            >{/each}
          {#if !node.expanded}{#each node.descriptionLines as line, i}<text
                x={METRICS.collapsed.contentX}
                y={METRICS.collapsed.titleY + 3 + node.titleLines.length * 21 + i * 17}
                class="node-description">{line}</text
              >{/each}{/if}
          <!-- The kind sits at the end of the title row: an icon, then the expand control. -->
          <g
            class="kind-icon"
            data-kind={node.kind}
            transform={`translate(${node.width - METRICS.toggleRight - METRICS.kindIconSize - (childIds.has(node.id) ? METRICS.toggleSize + METRICS.kindIconGap : 0)} ${METRICS.toggleY + (METRICS.toggleSize - METRICS.kindIconSize) / 2}) scale(${METRICS.kindIconSize / 24})`}
            color={theme.appearance === 'dark' ? theme.accent : node.color}
            use:tip={{ title: node.kindLabel, text: kindHint(node.kind) }}
          >
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
              onclick={(e) => {
                e.stopPropagation();
                clearPeek();
                ontoggle(node.id);
              }}
              onkeydown={oncommandkey}
              onpointerenter={(e) => requestPeek(node.id, e.currentTarget.getBoundingClientRect())}
              onpointerleave={clearPeek}
              onfocus={(e) => requestPeek(node.id, e.currentTarget.getBoundingClientRect())}
              onblur={clearPeek}
              aria-describedby={peekId === node.id ? 'component-peek' : undefined}
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
  </svg>
  {#if peek}
    <div
      id="component-peek"
      class="component-peek"
      role="tooltip"
      style={`left:${peekPosition.x}px;top:${peekPosition.y}px`}
    >
      <div class="peek-eyebrow">INSIDE {peek.element.title}</div>
      <strong>{peek.children.length} component{peek.children.length === 1 ? '' : 's'}</strong>
      <div class="peek-children">
        {#each peek.children.slice(0, 6) as child}<div>
            <i style={`background:${child.color}`}></i><span>{child.title}</span><small
              >{child.status === 'proposed' ? 'Proposed' : child.kind}</small
            >
          </div>{/each}
      </div>
      <p>
        {peek.children.length > 6 ? `+ ${peek.children.length - 6} more · ` : ''}Click + to explore
        this layer
      </p>
    </div>
  {/if}
  {#if !presentation}<FitControl onfit={fit} label="Fit diagram" />{/if}
</div>

<style>
  .canvas {
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
  .edge {
    cursor: pointer;
    outline: none;
  }
  .node.presenter-active > rect,
  .node:focus-visible > rect,
  .edge:focus-visible > path {
    stroke: var(--accent, #267566);
    stroke-width: 3;
  }
  .node-title {
    font-family: 'Inter Variable', Inter, Arial, sans-serif;
    font-size: 14px;
    font-weight: 560;
    letter-spacing: -0.1px;
    fill: var(--text, #273d35);
  }
  .node-description {
    font-size: 12px;
    fill: var(--muted, #69766f);
  }
  .kind-icon {
    opacity: 0.85;
  }
  .edge-label {
    font-size: 11px;
    fill: var(--labelText, #65766d);
    paint-order: stroke;
    stroke: var(--canvas, #f7f8f5);
    stroke-width: 6px;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .expand-control:hover rect {
    fill: var(--hover, #dbe7e0);
  }
  .canvas-help {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .component-peek {
    position: absolute;
    width: 280px;
    padding: 18px;
    border: 1px solid var(--border, #d9dfdb);
    border-radius: 14px;
    background: var(--card, white);
    color: var(--text, #273d35);
    box-shadow: 0 12px 40px #152d2824;
    pointer-events: none;
    z-index: 4;
  }
  .peek-eyebrow {
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--muted, #69766f);
    margin-bottom: 8px;
  }
  .component-peek strong {
    font-size: 16px;
  }
  .peek-children {
    margin-top: 12px;
    display: grid;
    gap: 9px;
  }
  .peek-children div {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .peek-children i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .peek-children span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .peek-children small {
    margin-left: auto;
    color: var(--muted, #69766f);
    font-size: 9px;
  }
  .component-peek p {
    color: var(--muted, #69766f);
    font-size: 10px;
    margin: 15px 0 0;
  }
</style>
