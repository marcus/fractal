<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronRight } from '@marcusv/roc/svelte/outline';
  let { label, heading, children }: { label?: string; heading?: Snippet; children: Snippet } =
    $props();
</script>

<details>
  <summary>
    {#if heading}{@render heading()}{:else}<span>{label}</span>{/if}
    <span class="chevron" aria-hidden="true"><ChevronRight size={12} /></span>
  </summary>
  {@render children()}
</details>

<style>
  summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.55;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    color: var(--ui-accent, #365b42);
  }
  summary:focus-visible {
    outline: 2px solid var(--ui-accent, #365b42);
    outline-offset: 4px;
  }
  .chevron {
    display: flex;
    padding-top: 4px;
    margin-left: auto;
    flex-shrink: 0;
    color: var(--ui-subtle, #8b9785);
  }
  .chevron :global(svg) {
    transition: transform 160ms ease;
  }
  details[open] > summary .chevron :global(svg) {
    transform: rotate(90deg);
  }
  @media (pointer: coarse) {
    summary {
      min-height: 44px;
      align-items: center;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chevron :global(svg) {
      transition: none;
    }
  }
</style>
