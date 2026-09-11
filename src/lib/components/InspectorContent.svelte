<script lang="ts">
  import type { Snippet } from 'svelte';
  import { kindHint, kindIcon, kindTitle } from '$lib/core/kind-icons';
  import { tip } from '$lib/ui/tooltip.svelte';
  let {
    kind,
    title,
    proposed = false,
    children,
    class: className = ''
  }: {
    /** The selection's kind as authored; it picks the icon and reads out in the tooltip. */
    kind: string;
    title: string;
    /** Folds the status into the kind: the icon takes the proposed colour and the label says so. */
    proposed?: boolean;
    children: Snippet;
    class?: string;
  } = $props();
  const label = $derived(kindTitle(kind, proposed ? 'proposed' : 'current'));
</script>

<aside class={`inspector ${className}`} aria-label="Selection details">
  <div class="title-line">
    <h2>{title}</h2>
    <!-- The kind is the same icon the node carries, explained on hover; the readable kind
         stays in the accessible name and under Technical details. -->
    <span
      class="kind"
      class:proposed
      role="img"
      aria-label={label}
      data-kind={kind}
      use:tip={{ title: label, text: kindHint(kind) }}
      ><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
        >{@html kindIcon(kind).markup}</svg
      ></span
    >
  </div>
  {@render children()}
</aside>

<style>
  .inspector {
    padding-top: 4px;
  }
  .title-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .kind {
    flex: 0 0 auto;
    display: inline-flex;
    width: 22px;
    height: 22px;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--ui-accent, #365b42);
    opacity: 0.85;
  }
  .kind.proposed {
    color: var(--ui-proposed, #a18748);
  }
  h2 {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 16px;
    line-height: 1.35;
    letter-spacing: 0.1px;
    font-weight: 500;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .inspector :global(.meta),
  .inspector :global(.route) {
    font-size: 11px;
    line-height: 1.55;
    color: var(--ui-muted, #73806e);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .inspector :global(.description) {
    font-size: 12px;
    line-height: 1.65;
    margin: 12px 0 0;
    overflow-wrap: anywhere;
  }
  .inspector :global(h3) {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.2px;
    color: var(--ui-muted, #73806e);
    margin: 28px 0 17px;
  }
  .inspector :global(dl) {
    grid-template-columns: 74px minmax(0, 1fr);
    gap: 8px;
    margin: 13px 0 0;
  }
  .inspector :global(dd) {
    overflow-wrap: anywhere;
  }
  .inspector :global(code) {
    font:
      11px ui-monospace,
      monospace;
    color: var(--ui-muted, #73806e);
    overflow-wrap: anywhere;
  }
  .inspector :global(.secondary) {
    margin-top: 34px;
    display: grid;
    gap: 18px;
  }
  .inspector :global(.secondary > details > summary) {
    color: var(--ui-muted, #73806e);
  }
  .inspector :global(.context),
  .inspector :global(.detail-copy) {
    color: var(--ui-muted, #73806e);
    font-size: 12px;
    line-height: 1.65;
    margin: 12px 0 0;
    overflow-wrap: anywhere;
    white-space: pre-line;
  }
  .inspector :global(.item-title) {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.5;
    overflow-wrap: anywhere;
    color: var(--ui-text, #283d34);
  }
  .inspector :global(.item-summary) {
    min-width: 0;
  }
  .inspector :global(.item-summary .route) {
    display: block;
    margin-top: 5px;
  }
  .inspector :global(.item-list) {
    display: grid;
    gap: 23px;
  }
</style>
