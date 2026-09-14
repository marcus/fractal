<script lang="ts">
  import type { ComposedBridge } from '$lib/composition/types';

  /**
   * One cross-project claim drawn in composed coordinates. The route is already routed by the
   * composition core, so this component only draws it: an invisible wide hit path, the visible
   * line with its arrowhead, and the measured label. It is a native focusable button so a
   * keyboard reader reaches the same selection a click produces.
   */
  let {
    bridge,
    selected = false,
    onselect
  }: {
    bridge: ComposedBridge;
    selected?: boolean;
    onselect: (bridge: ComposedBridge) => void;
  } = $props();
  const path = $derived(
    bridge.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  );
</script>

<g
  class="bridge"
  class:selected
  data-interactive="bridge"
  data-connection-owner={bridge.owner}
  data-connection-id={bridge.id}
  role="button"
  tabindex="0"
  aria-label={`${bridge.title}: ${bridge.source.model}/${bridge.source.element} to ${bridge.target.model}/${bridge.target.element}`}
  onclick={() => onselect(bridge)}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onselect(bridge);
    }
  }}
>
  <path d={path} fill="none" stroke="transparent" stroke-width="16" />
  <path
    d={path}
    fill="none"
    stroke={selected ? 'var(--accent, #267566)' : 'var(--edge, #84948b)'}
    stroke-width={selected ? 2.5 : 1.5}
    stroke-dasharray={bridge.status === 'proposed' ? '6 5' : undefined}
    marker-end={selected ? 'url(#composition-arrow-selected)' : 'url(#composition-arrow)'}
  />
  <g transform={`translate(${bridge.label.x} ${bridge.label.y})`}>
    {#each bridge.labelLines as line, index}<text
        x="0"
        y={index * 15}
        text-anchor="middle"
        class="bridge-label">{line}</text
      >{/each}
  </g>
</g>

<style>
  .bridge {
    cursor: pointer;
    outline: none;
  }
  .bridge:focus-visible > path {
    stroke: var(--accent, #267566);
    stroke-width: 3;
  }
  .bridge-label {
    font-size: 11px;
    fill: var(--labelText, #65766d);
    paint-order: stroke;
    stroke: var(--canvas, #f7f8f5);
    stroke-width: 6px;
    stroke-linejoin: round;
    pointer-events: none;
  }
</style>
