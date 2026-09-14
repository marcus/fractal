<script lang="ts">
  import { COMPOSITION_METRICS } from '$lib/composition/place';
  import { ARCHITECTURE_NODE_METRICS as NODE_METRICS } from '$lib/core/node-metrics';
  import type { ComposedProject } from '$lib/composition/types';

  /**
   * One project's presentation geometry: a solid perimeter, a measured title band and a native
   * menu trigger. A frame is ownership drawn on one canvas, never a synthetic parent element or a
   * membership claim. Ids are namespaced by project so two projects may both own a `cli`.
   */
  let {
    project,
    menuOpen = false,
    onmenu
  }: {
    project: ComposedProject;
    menuOpen?: boolean;
    onmenu: (model: string) => void;
  } = $props();
  const slug = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-');
  const titleId = $derived(`project-title-${slug(project.model)}`);
  // The menu sits at the frame's leading edge, so it stays reachable when a wide frame is panned.
  const menuX = $derived(project.frame.x + COMPOSITION_METRICS.padding + 2);
  const menuY = $derived(project.frame.y + COMPOSITION_METRICS.titleClearance);
  const titleX = $derived(
    project.frame.x + COMPOSITION_METRICS.padding + COMPOSITION_METRICS.titleClearance + 18
  );
  const firstLineY = $derived(
    project.frame.y + COMPOSITION_METRICS.titleClearance + NODE_METRICS.titleSize
  );
</script>

<g
  class="project-frame"
  data-project-frame={project.model}
  data-project-mode={project.mode}
  aria-labelledby={titleId}
>
  <rect
    class="perimeter"
    x={project.frame.x}
    y={project.frame.y}
    width={project.frame.width}
    height={project.frame.height}
    rx="18"
  />
  <line
    class="title-rule"
    x1={project.frame.x}
    y1={project.frame.y + project.titleHeight}
    x2={project.frame.x + project.frame.width}
    y2={project.frame.y + project.titleHeight}
  />
  {#each project.titleLines as line, index}<text
      id={index === 0 ? titleId : undefined}
      class="project-title"
      x={titleX}
      y={firstLineY + index * COMPOSITION_METRICS.titleLineHeight}>{line}</text
    >{/each}
  <g
    class="project-menu-trigger"
    data-interactive="project-menu"
    role="button"
    tabindex="0"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    aria-label={`Project options: ${project.title}`}
    transform={`translate(${menuX} ${menuY})`}
    onclick={(event) => {
      event.stopPropagation();
      onmenu(project.model);
    }}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onmenu(project.model);
      }
    }}
  >
    <rect width="24" height="24" rx="6" fill="transparent" />
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
  </g>
  {#if project.mode === 'collapsed'}
    <text class="project-summary" x={titleX} y={project.frame.y + project.titleHeight + 30}
      >Collapsed summary</text
    >
  {/if}
</g>

<style>
  .project-frame {
    pointer-events: none;
  }
  .perimeter {
    fill: var(--surface, #f7f8f5);
    fill-opacity: 0.5;
    stroke: var(--border, #d9e0da);
    stroke-width: 1.2;
  }
  .title-rule {
    stroke: var(--divider, #dce2db);
    stroke-width: 1;
  }
  .project-title {
    font-family: 'Inter Variable', Inter, Arial, sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.1px;
    fill: var(--text, #243b34);
  }
  .project-summary {
    font-size: 12px;
    fill: var(--muted, #67746e);
  }
  .project-menu-trigger {
    pointer-events: auto;
    cursor: pointer;
    color: var(--muted, #67746e);
    outline: none;
  }
  .project-menu-trigger rect:hover,
  .project-menu-trigger:focus-visible rect {
    fill: var(--hover, #edf1ea);
  }
  .project-menu-trigger circle {
    fill: currentColor;
  }
</style>
