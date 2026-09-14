<script lang="ts">
  import type { ComposedBridge } from '$lib/composition/types';

  /**
   * One cross-project claim drawn in composed coordinates. The route is already routed by the
   * composition core, so this component only draws it: an invisible wide hit path, the visible
   * line with its arrowhead, and the measured label. It is a native focusable button so a
   * keyboard reader reaches the same selection a click produces.
   *
   * A bridge also renders as a passive echo above project content: SVG paint order and hit
   * testing are the same order, so the echo carries the visible line and label (never
   * interactive, never a second accessible node) while the full button below keeps clicks,
   * focus and selection. Both surfaces then agree with the composed SVG export, where
   * bridges draw above all project layers, without a bridge stealing node clicks.
   */
  let {
    bridge,
    selected = false,
    dormant = false,
    onselect,
    passive = false
  }: {
    bridge: ComposedBridge;
    selected?: boolean;
    dormant?: boolean;
    onselect: (bridge: ComposedBridge) => void;
    passive?: boolean;
  } = $props();
  const path = $derived(
    bridge.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  );
  // A proposed bridge draws dashed in the proposed colour, like the composed SVG export and
  // the single-model proposed edges, so the canvas and the export agree.
  const lineStroke = $derived(
    selected
      ? 'var(--accent, #267566)'
      : bridge.status === 'proposed'
        ? 'var(--proposed, #a98243)'
        : 'var(--edge, #84948b)'
  );
  const lineMarker = $derived(
    selected
      ? 'url(#composition-arrow-selected)'
      : bridge.status === 'proposed'
        ? 'url(#composition-arrow-proposed)'
        : 'url(#composition-arrow)'
  );
</script>

{#if passive}
  <g class="bridge-echo" aria-hidden="true" pointer-events="none">
    <path
      d={path}
      fill="none"
      stroke={lineStroke}
      stroke-width={selected ? 2.5 : 1.5}
      stroke-dasharray={bridge.status === 'proposed' ? '6 5' : undefined}
      marker-end={lineMarker}
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
{:else}
  <g
    class="bridge"
    class:selected
    data-interactive="bridge"
    data-connection-owner={dormant ? undefined : bridge.owner}
    data-connection-id={dormant ? undefined : bridge.id}
    role="button"
    tabindex="0"
    data-bridge-count={bridge.count}
    aria-label={`${bridge.title}${bridge.count > 1 ? ` ×${bridge.count}` : ''}: ${bridge.source.model}/${bridge.source.element} to ${bridge.target.model}/${bridge.target.element}`}
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
      stroke={lineStroke}
      stroke-width={selected ? 2.5 : 1.5}
      stroke-dasharray={bridge.status === 'proposed' ? '6 5' : undefined}
      marker-end={lineMarker}
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
{/if}

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
