<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { X } from '@marcusv/roc/svelte/outline';
  import { panelMotion } from '$lib/ui/panel-motion';
  import { floatingPanel, panelResizer } from '$lib/ui/floating-panel';
  import {
    INSPECTOR_MAX_WIDTH,
    INSPECTOR_MIN_WIDTH,
    inspectorWidthPreference,
    panelHeightPreference,
    panelOffsetPreference,
    rememberInspectorWidth,
    rememberPanelHeight,
    rememberPanelOffset
  } from '$lib/ui/preferences';

  /**
   * The inspector's chrome, shared by the architecture and sequence studios: a draggable card
   * with a grip, an edge for width, an edge for height, and a corner for both. Where the reader
   * drags it is remembered with its size, so it reopens in the same place.
   */
  let {
    onsettled,
    onclose,
    label = 'Inspector',
    children
  }: { onsettled?: () => void; onclose?: () => void; label?: string; children: Snippet } = $props();
  let shell: HTMLDivElement;
  /** Folded up to its title, Mac OS 9 style, by a double-click on the grip. Session chrome. */
  let shaded = $state(false);

  const clampWidth = (width: number) =>
    Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, Math.round(width)));
  function applyWidth(width: number) {
    const clamped = clampWidth(width);
    shell.closest<HTMLElement>('.studio')?.style.setProperty('--inspector-width', `${clamped}px`);
    return clamped;
  }
  onMount(() => {
    const saved = inspectorWidthPreference();
    if (saved) applyWidth(saved);
  });
  const onwidth = (width: number, phase: 'move' | 'end') => {
    const clamped = applyWidth(width);
    if (phase === 'end') rememberInspectorWidth(clamped);
  };
  const onheight = (height: number | null) => rememberPanelHeight('inspector', height);
</script>

<div
  class="inspector-shell"
  bind:this={shell}
  transition:panelMotion|global
  class:shaded
  onintroend={onsettled}
  use:floatingPanel={{
    oncollapse: () => (shaded = !shaded),
    initialOffset: panelOffsetPreference('inspector'),
    onmove: (offset) => rememberPanelOffset('inspector', offset)
  }}
>
  <div
    class="panel-grip"
    data-panel-grip
    title={shaded ? 'Double-click to unfold' : 'Drag to move · double-click to fold up'}
  >
    <span class="panel-shade-label">{label}</span>
    <button class="icon-button panel-close" aria-label="Close inspector" onclick={onclose}
      ><X size={15} /></button
    >
  </div>
  {@render children()}
  <button
    class="panel-resizer panel-resizer-x"
    aria-label="Resize inspector width"
    use:panelResizer={{ axes: 'x', xEdge: 'left', onwidth }}
  ></button>
  <button
    class="panel-resizer panel-resizer-y"
    aria-label="Resize inspector height"
    title="Drag to resize · double-click to fit content"
    use:panelResizer={{ axes: 'y', initialHeight: panelHeightPreference('inspector'), onheight }}
  ></button>
  <button
    class="panel-resizer panel-resizer-corner"
    aria-label="Resize inspector"
    use:panelResizer={{ axes: 'xy', xEdge: 'left', onwidth, onheight }}
  ></button>
</div>
