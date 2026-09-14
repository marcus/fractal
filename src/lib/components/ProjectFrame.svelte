<script lang="ts">
  import { COMPOSITION_METRICS } from '$lib/composition/place';
  import {
    COMPOSITION_PORT_CAPTION,
    COMPOSITION_PORT_LABEL_LINE_HEIGHT,
    compositionPortGeometry
  } from '$lib/composition/ports';
  import { ARCHITECTURE_NODE_METRICS as NODE_METRICS } from '$lib/core/node-metrics';
  import type { ComposedPort, ComposedProject } from '$lib/composition/types';

  /**
   * One project's presentation geometry: a solid perimeter, a measured title band and a native
   * menu trigger. A frame is ownership drawn on one canvas, never a synthetic parent element or a
   * membership claim. Ids are namespaced by project so two projects may both own a `cli`.
   */
  let {
    project,
    linked = false,
    menuOpen = false,
    dormant = false,
    onmenu,
    onrevealport
  }: {
    project: ComposedProject;
    linked?: boolean;
    menuOpen?: boolean;
    dormant?: boolean;
    onmenu: (model: string) => void;
    onrevealport?: (port: ComposedPort) => void;
  } = $props();
  const slug = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-');
  const titleId = $derived(`project-title-${slug(project.model)}`);
  // Title-band tap targets stay at least 44px so touch reaches the same menu a pointer does.
  const menuSize = 44;
  // The menu sits at the frame's leading edge, so it stays reachable when a wide frame is panned.
  const menuX = $derived(project.frame.x + COMPOSITION_METRICS.padding);
  const menuY = $derived(project.frame.y + Math.max(4, (project.titleHeight - menuSize) / 2));
  const titleX = $derived(menuX + menuSize + 8);
  const firstLineY = $derived(
    project.frame.y + COMPOSITION_METRICS.titleClearance + NODE_METRICS.titleSize
  );
</script>

<g
  class="project-frame"
  data-project-frame={dormant ? undefined : project.model}
  data-project-mode={dormant ? undefined : project.mode}
  aria-labelledby={titleId}
>
  <rect
    class="perimeter"
    class:linked
    data-project-linked={linked ? 'true' : 'false'}
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
    <rect width={menuSize} height={menuSize} rx="8" fill="transparent" />
    <circle cx="14" cy="22" r="1.8" />
    <circle cx="22" cy="22" r="1.8" />
    <circle cx="30" cy="22" r="1.8" />
  </g>
  {#if project.mode === 'collapsed'}
    <text class="project-summary" x={titleX} y={project.frame.y + project.titleHeight + 30}
      >Collapsed summary</text
    >
  {/if}
  {#each project.ports as port (`${port.side}:${port.reveal.element}`)}
    {@const geometry = compositionPortGeometry(port.side, port.point, port.labelLines)}
    <g
      class="project-port"
      data-interactive="port"
      data-project-port={project.model}
      data-port-side={port.side}
      data-port-element={port.reveal.element}
      data-port-count={port.count}
      role="button"
      tabindex="0"
      aria-label={`Outside-scope port: ${port.title}. Reveal ${port.reveal.element}.`}
      transform={`translate(${geometry.position.x} ${geometry.position.y})`}
      onclick={(event) => {
        event.stopPropagation();
        onrevealport?.(port);
      }}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onrevealport?.(port);
        }
      }}
    >
      <rect width={geometry.width} height={geometry.height} rx="7" class="port-tab" />
      {#each port.labelLines as line, index}
        <text
          x={geometry.width / 2}
          y={geometry.labelY + index * COMPOSITION_PORT_LABEL_LINE_HEIGHT}
          text-anchor="middle"
          class="port-label">{line}</text
        >
      {/each}
      <text x={geometry.width / 2} y={geometry.captionY} text-anchor="middle" class="port-caption"
        >{COMPOSITION_PORT_CAPTION}</text
      >
    </g>
  {/each}
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
  .perimeter.linked {
    fill: var(--linkedSurface, #eef4ef);
    fill-opacity: 0.72;
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
  .project-port {
    pointer-events: auto;
    cursor: pointer;
    outline: none;
  }
  .port-tab {
    fill: var(--card, #fff);
    stroke: var(--accent, #267566);
    stroke-width: 1.2;
  }
  .project-port:focus-visible .port-tab {
    stroke-width: 2;
  }
  .port-label {
    font-size: 10px;
    font-weight: 600;
    fill: var(--text, #243b34);
    pointer-events: none;
  }
  .port-caption {
    font-size: 8px;
    fill: var(--muted, #67746e);
    pointer-events: none;
  }
</style>
