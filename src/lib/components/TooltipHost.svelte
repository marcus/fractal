<script lang="ts">
  import { TOOLTIP_ID, tooltip } from '$lib/ui/tooltip.svelte';

  const shown = $derived(tooltip.current);
  const position = $derived.by(() => {
    if (!shown) return { left: 0, top: 0, above: false };
    const { rect } = shown;
    const width = 240;
    const left = Math.max(
      8,
      Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)
    );
    const above = rect.bottom + 84 > innerHeight;
    return { left, top: above ? rect.top - 8 : rect.bottom + 8, above };
  });
</script>

<svelte:window
  onscroll={() => tooltip.hide()}
  onkeydown={(e) => e.key === 'Escape' && tooltip.hide()}
/>
{#if shown}
  <div
    id={TOOLTIP_ID}
    class="tooltip"
    class:above={position.above}
    role="tooltip"
    style={`left:${position.left}px;top:${position.top}px`}
  >
    {#if shown.content.title}<strong>{shown.content.title}</strong>{/if}
    <span>{shown.content.text}</span>
  </div>
{/if}

<style>
  .tooltip {
    position: fixed;
    z-index: 40;
    width: 240px;
    padding: 9px 12px 10px;
    display: grid;
    gap: 3px;
    border-radius: 9px;
    background: var(--ui-card, #fff);
    color: var(--ui-muted, #59675d);
    font-size: 11px;
    line-height: 1.45;
    box-shadow:
      0 10px 30px #10251a1c,
      0 1px 3px #10251a14;
    pointer-events: none;
    animation: tooltip-in 140ms ease-out;
  }
  .tooltip.above {
    transform: translateY(-100%);
  }
  .tooltip strong {
    color: var(--ui-text, #283d34);
    font-size: 11.5px;
    font-weight: 560;
  }
  @keyframes tooltip-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tooltip {
      animation: none;
    }
  }
</style>
