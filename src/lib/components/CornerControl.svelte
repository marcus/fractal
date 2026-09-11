<script lang="ts">
  import type { Snippet } from 'svelte';
  /**
   * A quiet square control pinned to the studio's bottom-left corner: the navigation toggle and
   * the fit control are the same card, so they read as one row. Styling lives with the other
   * floating chrome in `src/app.css` under `.corner-control`; `class` places the control.
   */
  let {
    label,
    title = label,
    onclick,
    class: className = '',
    controls,
    expanded,
    children
  }: {
    label: string;
    title?: string;
    onclick: () => void;
    class?: string;
    /** For a toggle: the id of what it shows or hides, and whether that is showing. */
    controls?: string;
    expanded?: boolean;
    children: Snippet;
  } = $props();
</script>

<button
  class={`icon-button corner-control ${className}`}
  aria-label={label}
  {title}
  aria-controls={controls}
  aria-expanded={expanded}
  {onclick}>{@render children()}</button
>
