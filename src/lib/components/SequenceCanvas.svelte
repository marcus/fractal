<script lang="ts">
  import FitControl from './FitControl.svelte';
  import { onMount, untrack } from 'svelte';
  import { maximumCanvasZoom } from '$lib/ui/zoom';
  import { getTheme } from '$lib/core/themes';
  import { PARTICIPANT_HEADER, selfMessagePath } from '$lib/sequence/metrics';
  import type {
    SequenceColumn,
    SequenceDiagram,
    SequenceGap,
    SequenceRow
  } from '$lib/sequence/types';

  let {
    diagram,
    selected,
    presentation = false,
    onselect,
    ontogglephase,
    ontogglegroup,
    onreveallanes,
    measureInsets = () => ({ left: 0, right: 0, top: 0, bottom: 0 })
  }: {
    diagram: SequenceDiagram | null;
    selected: string | null;
    presentation?: boolean;
    onselect: (id: string) => void;
    ontogglephase: (id: string) => void;
    ontogglegroup: (id: string) => void;
    onreveallanes: (ids: string[]) => void;
    measureInsets?: () => Insets;
  } = $props();
  type Insets = { left: number; right: number; top: number; bottom: number };

  type AnimatedColumn = SequenceColumn & { opacity: number; targetX: number };
  type AnimatedGap = SequenceGap & { opacity: number; targetX: number };
  type AnimatedRow = SequenceRow & { opacity: number; targetY: number };
  let columns = $state<AnimatedColumn[]>([]);
  let gaps = $state<AnimatedGap[]>([]);
  let rows = $state<AnimatedRow[]>([]);
  let world = $state({ width: 1200, height: 700 });
  let camera = $state({ x: 0, y: 0, zoom: 1 });
  let size = $state({ width: 1000, height: 600 });
  // Floating chrome covers the canvas edges rather than narrowing it. The fit region is captured
  // when the reader fits, never when a panel opens or closes.
  let fitInsets = $state<Insets>({ left: 0, right: 0, top: 0, bottom: 0 });
  const fitWidth = $derived(Math.max(240, size.width - fitInsets.left - fitInsets.right));
  const fitHeight = $derived(Math.max(240, size.height - fitInsets.top - fitInsets.bottom));
  let svg: SVGSVGElement;
  let activeId = $state<string | null>(null);
  let dragging: { x: number; y: number; cameraX: number; cameraY: number } | null = null;
  let moved = false;
  let frame = 0;
  let reduced = $state(true);
  let loaded = false;
  let measured = false;
  let bounds = { left: 0, top: 0 };
  let pendingFit = false;
  // The canvas always mounts outside presentation; both studios render it before toggling.
  let presenting = false;
  let pendingLaneFocus: string | null = null;

  const theme = $derived(getTheme(diagram?.state.theme));
  const fitScale = $derived(
    Math.min(fitWidth / Math.max(1, world.width + 96), fitHeight / Math.max(1, world.height + 96))
  );
  const maximumZoom = $derived(maximumCanvasZoom(fitScale));
  const factor = $derived(fitScale * camera.zoom);
  const tx = $derived(fitInsets.left + (fitWidth - world.width * factor) / 2 + camera.x);
  const ty = $derived(fitInsets.top + (fitHeight - world.height * factor) / 2 + camera.y);

  const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
  const column = (id?: string) => columns.find((item) => item.id === id);
  const isSummary = (row: SequenceRow) => row.type === 'internal' || row.type === 'hidden';

  export function zoom(direction: number) {
    camera = {
      ...camera,
      zoom: Math.max(0.35, Math.min(maximumZoom, camera.zoom * (direction > 0 ? 1.2 : 1 / 1.2)))
    };
  }
  export function fit() {
    fitInsets = measureInsets();
    camera = { x: 0, y: 0, zoom: 1 };
  }
  export function activate() {
    if (!activeId) return;
    const gap = gaps.find((item) => item.id === activeId);
    if (gap) revealGap(gap);
    else onselect(activeId);
  }
  export function toggleActive() {
    if (!activeId) return;
    const row = rows.find((item) => item.id === activeId);
    const col = columns.find((item) => item.id === activeId);
    const gap = gaps.find((item) => item.id === activeId);
    if (row?.type === 'phase' && !row.contextOnly) ontogglephase(row.id);
    else if (col && col.memberIds.length > 1) ontogglegroup(col.id);
    else if (gap) revealGap(gap);
  }
  export function outward() {
    activeId = null;
    svg?.focus({ preventScroll: true });
  }
  export function navigate(direction: 'left' | 'right' | 'up' | 'down') {
    const rowIndex = rows.findIndex((item) => item.id === activeId);
    const horizontal = [...columns, ...gaps].sort((a, b) => a.x - b.x);
    const columnIndex = horizontal.findIndex((item) => item.id === activeId);
    if (direction === 'up' || direction === 'down') {
      const start = rowIndex >= 0 ? rowIndex : direction === 'down' ? -1 : rows.length;
      const next = Math.max(0, Math.min(rows.length - 1, start + (direction === 'down' ? 1 : -1)));
      if (rows[next]) focusItem(rows[next].id);
    } else {
      const start = columnIndex >= 0 ? columnIndex : direction === 'right' ? -1 : horizontal.length;
      const next = Math.max(
        0,
        Math.min(horizontal.length - 1, start + (direction === 'right' ? 1 : -1))
      );
      if (horizontal[next]) focusItem(horizontal[next].id);
    }
  }
  function focusItem(id: string) {
    activeId = id;
    requestAnimationFrame(() => {
      const item = svg?.querySelector<SVGGElement>(`[data-sequence-id="${CSS.escape(id)}"]`);
      item?.focus({ preventScroll: true });
      if (!item) return;
      const box = item.getBoundingClientRect();
      const viewport = svg.getBoundingClientRect();
      const margin = 36;
      const dx =
        box.left < viewport.left + margin
          ? viewport.left + margin - box.left
          : box.right > viewport.right - margin
            ? viewport.right - margin - box.right
            : 0;
      const dy =
        box.top < viewport.top + margin
          ? viewport.top + margin - box.top
          : box.bottom > viewport.bottom - margin
            ? viewport.bottom - margin - box.bottom
            : 0;
      if (dx || dy) camera = { ...camera, x: camera.x + dx, y: camera.y + dy };
    });
  }
  function revealGap(gap: SequenceGap) {
    pendingLaneFocus = gap.participantIds[0] ?? null;
    onreveallanes(gap.participantIds);
  }

  /** The fit scale a viewport of this size would give the diagram as it stands. */
  function scaleFor(width: number, height: number) {
    return Math.min(width / Math.max(1, world.width + 96), height / Math.max(1, world.height + 96));
  }

  /** Entering or leaving presentation reframes the diagram deliberately, so it refits. */
  $effect(() => {
    const mode = presentation;
    untrack(() => {
      if (!measured || mode === presenting) return;
      presenting = mode;
      pendingFit = true;
      fit();
      // Clear only once the resize this triggered has been observed and skipped.
      requestAnimationFrame(() => requestAnimationFrame(() => (pendingFit = false)));
    });
  });

  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = media.matches;
    const update = () => (reduced = media.matches);
    media.addEventListener('change', update);
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (!next.width || !next.height) return;
      const origin = svg.getBoundingClientRect();
      // Opening the inspector or hiding the sidebar takes width from the canvas, and can move
      // its left edge too. Hold the diagram where the reader last saw it on screen instead of
      // silently re-fitting — and so zooming out — underneath them. The first measurement
      // only replaces the placeholder size, so it fits rather than holds.
      if (measured && !pendingFit) {
        const before = scaleFor(size.width, size.height);
        const after = scaleFor(next.width, next.height);
        // A reader already at the zoom limit cannot hold scale exactly. Clamp, and hold the
        // position regardless, so the result stays as still as the limits allow.
        const held =
          before > 0 && after > 0
            ? Math.max(0.35, Math.min(maximumCanvasZoom(after), camera.zoom * (before / after)))
            : camera.zoom;
        camera = {
          zoom: held,
          x: camera.x + (size.width - next.width) / 2 + (bounds.left - origin.left),
          y: camera.y + (size.height - next.height) / 2 + (bounds.top - origin.top)
        };
      }
      if (!measured) fitInsets = measureInsets();
      measured = true;
      size = next;
      bounds = { left: origin.left, top: origin.top };
    });
    observer.observe(svg);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', update);
    };
  });

  function animate(next: SequenceDiagram) {
    cancelAnimationFrame(frame);
    const oldColumns = [...columns];
    const oldGaps = [...gaps];
    const oldRows = [...rows];
    const fromWorld = { ...world };
    const started = performance.now();
    const duration = reduced || !loaded ? 0 : 360;
    loaded = true;
    const columnTransitions = next.columns.map((target, index) => ({
      target,
      from:
        oldColumns.find((item) => item.id === target.id) ??
        ({ ...target, x: oldColumns[index]?.x ?? target.x, opacity: 0 } as AnimatedColumn)
    }));
    const rowTransitions = next.rows.map((target, index) => ({
      target,
      from:
        oldRows.find((item) => item.id === target.id) ??
        ({ ...target, y: oldRows[index]?.y ?? target.y, opacity: 0 } as AnimatedRow)
    }));
    const gapTransitions = next.gaps.map((target) => ({
      target,
      from:
        oldGaps.find((item) => item.id === target.id) ?? ({ ...target, opacity: 0 } as AnimatedGap)
    }));
    function step(now: number) {
      const p = duration ? Math.min(1, (now - started) / duration) : 1;
      const ease = 1 - Math.pow(1 - p, 3);
      world = {
        width: lerp(fromWorld.width, next.width, ease),
        height: lerp(fromWorld.height, next.height, ease)
      };
      columns = columnTransitions.map(({ target, from }) => ({
        ...target,
        x: lerp(from.x, target.x, ease),
        width: lerp(from.width, target.width, ease),
        opacity: lerp(from.opacity ?? 1, 1, ease),
        targetX: target.x
      }));
      gaps = gapTransitions.map(({ target, from }) => ({
        ...target,
        x: lerp(from.x, target.x, ease),
        y: lerp(from.y, target.y, ease),
        width: lerp(from.width, target.width, ease),
        height: lerp(from.height, target.height, ease),
        opacity: lerp(from.opacity ?? 1, 1, ease),
        targetX: target.x
      }));
      rows = rowTransitions.map(({ target, from }) => ({
        ...target,
        x: lerp(from.x, target.x, ease),
        y: lerp(from.y, target.y, ease),
        width: lerp(from.width, target.width, ease),
        height: lerp(from.height, target.height, ease),
        titleX: lerp(from.titleX, target.titleX, ease),
        countX: lerp(from.countX, target.countX, ease),
        titleY: lerp(from.titleY, target.titleY, ease),
        descriptionY:
          target.descriptionY === undefined
            ? undefined
            : lerp(from.descriptionY ?? target.descriptionY, target.descriptionY, ease),
        arrowY:
          target.arrowY === undefined
            ? undefined
            : lerp(from.arrowY ?? target.arrowY, target.arrowY, ease),
        opacity: lerp(from.opacity ?? 1, 1, ease),
        targetY: target.y
      }));
      if (p < 1) frame = requestAnimationFrame(step);
      else if (pendingLaneFocus && next.columns.some((item) => item.id === pendingLaneFocus)) {
        const id = pendingLaneFocus;
        pendingLaneFocus = null;
        focusItem(id);
      }
    }
    frame = requestAnimationFrame(step);
  }
  $effect(() => {
    if (diagram) {
      const next = diagram;
      untrack(() => animate(next));
    }
  });

  function down(e: PointerEvent) {
    moved = false;
    // A drag can start anywhere, rows and columns included; a click still selects when the
    // pointer has not moved.
    if (e.button !== 0) return;
    dragging = { x: e.clientX, y: e.clientY, cameraX: camera.x, cameraY: camera.y };
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
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const zoom = Math.max(0.35, Math.min(maximumZoom, camera.zoom * Math.exp(-e.deltaY * 0.0015)));
    const box = svg.getBoundingClientRect();
    const ox = e.clientX - box.left - (fitInsets.left + fitWidth / 2);
    const oy = e.clientY - box.top - (fitInsets.top + fitHeight / 2);
    const ratio = zoom / camera.zoom;
    camera = { zoom, x: ox - (ox - camera.x) * ratio, y: oy - (oy - camera.y) * ratio };
  }
</script>

<div class="sequence-canvas" class:presentation>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Spatial diagram keyboard surface.) -->
  <svg
    bind:this={svg}
    role="application"
    tabindex="0"
    aria-label="Interactive sequence diagram"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (dragging = null)}
    onpointercancel={() => (dragging = null)}
    onwheel={wheel}
  >
    <defs>
      <pattern id="sequence-dots" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r=".7" fill={theme.canvasDots} />
      </pattern>
      <marker
        id="sequence-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10 Z" fill={theme.edge} />
      </marker>
      <marker
        id="sequence-arrow-open"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke={theme.edge} stroke-width="1.5" />
      </marker>
    </defs>
    <rect width="100%" height="100%" fill={theme.canvas} />
    <rect width="100%" height="100%" fill={presentation ? 'transparent' : 'url(#sequence-dots)'} />
    <g transform={`translate(${tx} ${ty}) scale(${factor})`}>
      {#each rows.filter((row) => row.type === 'phase') as row (row.id)}
        <g
          opacity={row.opacity}
          data-interactive="phase"
          data-sequence-id={row.id}
          data-message-ids={row.messageIds.join(',')}
          data-hidden-message-ids={row.hiddenMessageIds.join(',')}
          data-geometry-kind="phase"
          data-current-y={row.y.toFixed(2)}
          data-target-y={row.targetY.toFixed(2)}
          role="button"
          tabindex={activeId === row.id ? 0 : -1}
          aria-label={`${row.title}, ${row.contextOnly ? 'context' : row.collapsed ? 'collapsed' : 'expanded'} phase`}
          onfocus={() => (activeId = row.id)}
          onclick={() => !moved && ((activeId = row.id), onselect(row.id))}
          ondblclick={() => !row.contextOnly && ontogglephase(row.id)}
          onkeydown={() => {}}
        >
          {#if row.depth > 0}
            <rect x={row.x} y={row.y} width={row.width} height={row.height} fill="transparent" />
            <line
              x1={row.x}
              x2={row.x + row.width}
              y1={row.y + row.height - 2}
              y2={row.y + row.height - 2}
              stroke={theme.border}
              stroke-width="1.2"
              stroke-dasharray={row.collapsed ? '5 4' : undefined}
            />
          {:else}
            <rect
              x={row.x}
              y={row.y}
              width={row.width}
              height={row.height}
              rx="12"
              fill={theme.group}
              stroke={theme.border}
              stroke-dasharray={row.collapsed ? '5 4' : undefined}
            />
          {/if}
          {#each row.titleLines as line, i}<text
              x={row.titleX + (row.titleDx ?? 0)}
              y={row.titleY + i * 19}
              class="phase-title">{line}</text
            >{/each}
          {#if row.descriptionY}{#each row.descriptionLines as line, i}<text
                x={row.titleX + (row.descriptionDx ?? 0)}
                y={row.descriptionY + i * 15}
                class="description-line">{line}</text
              >{/each}{/if}
          <text x={row.countX} y={row.y + row.height / 2 + 4} text-anchor="end" class="phase-count"
            >{row.messageIds.length} interaction{row.messageIds.length === 1 ? '' : 's'}{row
              .hiddenMessageIds.length
              ? ` · ${row.hiddenMessageIds.length} hidden`
              : ''}{row.contextOnly ? ' · context' : row.collapsed ? ' · collapsed' : ''}</text
          >
        </g>
      {/each}
      {#each columns as item (item.id)}
        <g
          data-interactive="column"
          data-sequence-id={item.id}
          data-geometry-kind="column"
          data-current-x={item.x.toFixed(2)}
          data-target-x={item.targetX.toFixed(2)}
          role="button"
          tabindex={activeId === item.id ? 0 : -1}
          aria-label={`${item.title}${item.memberIds.length > 1 ? ', participant group' : ''}`}
          opacity={item.opacity}
          onfocus={() => (activeId = item.id)}
          onclick={() => !moved && ((activeId = item.id), onselect(item.id))}
          ondblclick={() => item.memberIds.length > 1 && ontogglegroup(item.id)}
          onkeydown={() => {}}
        >
          <line
            x1={item.x}
            x2={item.x}
            y1={item.y + item.height}
            y2={world.height - 24}
            stroke={theme.divider}
            stroke-width="1.2"
            stroke-dasharray="5 7"
          />
          <rect
            x={item.x - item.width / 2}
            y={item.y}
            width={item.width}
            height={item.height}
            rx="12"
            fill={theme.card}
            stroke={selected === item.id ? theme.accent : item.color}
            stroke-width={selected === item.id ? 2.5 : 2}
          />
          {#each item.titleLines as line, i}<text
              x={item.x}
              y={item.y + PARTICIPANT_HEADER.titleBaseline + i * PARTICIPANT_HEADER.lineHeight}
              text-anchor="middle"
              class="participant-title">{line}</text
            >{/each}
          {#if item.memberIds.length > 1}<text
              x={item.x + item.width / 2 - 9}
              y={item.y + 16}
              text-anchor="end"
              class="count">{item.memberIds.length}</text
            >{/if}
        </g>
      {/each}
      {#each gaps as gap (gap.id)}
        <g
          data-interactive="gap"
          data-sequence-id={gap.id}
          data-gap-id={gap.id}
          data-participant-ids={gap.participantIds.join(',')}
          data-geometry-kind="gap"
          data-current-x={gap.x.toFixed(2)}
          data-target-x={gap.targetX.toFixed(2)}
          role="button"
          tabindex={activeId === gap.id ? 0 : -1}
          aria-label={`Reveal ${gap.participantIds.length} hidden lane${gap.participantIds.length === 1 ? '' : 's'}: ${gap.titles.join(', ')}`}
          opacity={gap.opacity}
          onfocus={() => (activeId = gap.id)}
          onclick={() => !moved && revealGap(gap)}
          onkeydown={() => {}}
        >
          <title>Reveal hidden lanes: {gap.titles.join(', ')}</title>
          <rect
            x={gap.x - gap.width / 2}
            y={gap.y}
            width={gap.width}
            height={gap.height}
            rx="4"
            fill={theme.label}
            stroke="none"
          />
          <text x={gap.x} y={gap.y + 13} text-anchor="middle" class="gap-count"
            >{gap.participantIds.length}</text
          >
          <text x={gap.x} y={gap.y + 25} text-anchor="middle" class="gap-arrow">↔</text>
        </g>
      {/each}
      {#each rows.filter((row) => row.type !== 'phase') as row (row.id)}
        {@const from = column(row.from)}
        {@const to = column(row.to)}
        {@const x1 = from ? from.x : 58}
        {@const x2 = to ? to.x : world.width - 58}
        {@const anchorX = row.type === 'hidden' ? world.width / 2 : (x1 + x2) / 2}
        <g
          data-interactive="row"
          data-sequence-id={row.id}
          data-message-ids={row.messageIds.join(',')}
          data-hidden-message-ids={row.hiddenMessageIds.join(',')}
          data-geometry-kind="row"
          data-current-y={row.y.toFixed(2)}
          data-target-y={row.targetY.toFixed(2)}
          role="button"
          tabindex={activeId === row.id ? 0 : -1}
          aria-label={row.title}
          opacity={row.opacity}
          onfocus={() => (activeId = row.id)}
          onclick={() => !moved && ((activeId = row.id), onselect(row.id))}
          onkeydown={() => {}}
        >
          {#if row.type === 'hidden'}
            <rect
              x={world.width / 2 - 340}
              y={row.y}
              width="680"
              height={row.height}
              rx="9"
              fill={theme.label}
              stroke={theme.border}
              stroke-dasharray="4 4"
            />
          {:else if row.type === 'internal'}
            <rect
              x={x1 - Math.min(170, (from?.width ?? 188) / 2)}
              y={row.y}
              width={Math.min(340, from?.width ?? 188)}
              height={row.height}
              rx="9"
              fill={theme.label}
              stroke={theme.border}
            />
          {:else}
            <rect
              x={(x1 + x2) / 2 - 180}
              y={row.y}
              width="360"
              height={row.height - 16}
              rx="7"
              fill={theme.label}
            />
            {#if x1 === x2}
              <path
                d={selfMessagePath(x1, row.arrowY ?? row.y + row.height - 11)}
                fill="none"
                stroke={selected === row.id ? theme.accent : theme.edge}
                stroke-width={selected === row.id ? 2.4 : 1.7}
                stroke-dasharray={row.kind === 'return' ? '7 5' : undefined}
                marker-end={row.kind === 'async'
                  ? 'url(#sequence-arrow-open)'
                  : 'url(#sequence-arrow)'}
              />
            {:else}
              <line
                {x1}
                x2={x2 + (x2 > x1 ? -8 : 8)}
                y1={row.arrowY ?? row.y + row.height - 11}
                y2={row.arrowY ?? row.y + row.height - 11}
                stroke={selected === row.id ? theme.accent : theme.edge}
                stroke-width={selected === row.id ? 2.4 : 1.7}
                stroke-dasharray={row.kind === 'return' ? '7 5' : undefined}
                marker-end={row.kind === 'async'
                  ? 'url(#sequence-arrow-open)'
                  : 'url(#sequence-arrow)'}
              />
            {/if}
          {/if}
          {#each row.titleLines as line, i}<text
              x={anchorX + (row.titleDx ?? 0)}
              y={row.titleY + i * 19}
              text-anchor="middle"
              class:summary={isSummary(row)}
              class="message-title">{line}</text
            >{/each}
          {#if row.descriptionY}{#each row.descriptionLines as line, i}<text
                x={anchorX + (row.descriptionDx ?? 0)}
                y={row.descriptionY + i * 15}
                text-anchor="middle"
                class="description-line">{line}</text
              >{/each}{/if}
        </g>
      {/each}
    </g>
  </svg>
  {#if !presentation}<FitControl onfit={fit} label="Fit sequence" />{/if}
</div>

<style>
  .sequence-canvas {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 280px;
    overflow: hidden;
    user-select: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    font-family: 'Inter Variable', Inter, Arial, sans-serif;
  }
  svg:active {
    cursor: grabbing;
  }
  [data-interactive] {
    cursor: pointer;
    outline: none;
  }
  [data-interactive]:focus-visible rect {
    stroke: var(--accent, #267566);
    stroke-width: 3;
  }
  .participant-title {
    font-size: 15px;
    font-weight: 600;
    fill: var(--text);
  }
  .phase-title {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.2px;
    fill: var(--text);
  }
  .message-title {
    font-size: 13px;
    fill: var(--labelText);
  }
  .phase-count,
  .description-line {
    font-size: 11px;
    fill: var(--subtle);
  }
  .message-title.summary {
    font-weight: 600;
    stroke: none;
  }
  .count {
    font-size: 9px;
    fill: var(--subtle);
  }
  .gap-count {
    font-size: 11px;
    font-weight: 650;
    fill: var(--text);
  }
  .gap-arrow {
    font-size: 12px;
    fill: var(--subtle);
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      scroll-behavior: auto !important;
    }
  }
</style>
