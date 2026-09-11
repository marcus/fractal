<script lang="ts">
  import { SHORTCUTS, shortcutLabel } from '$lib/core/shortcuts';
  import { Info, ArrowUpRight } from '@marcusv/roc/svelte/outline';
  import type { Model, Diagram } from '$lib/core/types';
  let {
    model,
    diagram,
    onoutside
  }: { model: Model; diagram: Diagram | null; onoutside: () => void } = $props();
  let panel: HTMLDivElement;
  let button: HTMLButtonElement;
  let position = $state({ left: 0, bottom: 0 });
  let open = $state(false);
  export function close() {
    if (!panel?.matches(':popover-open')) return false;
    panel.hidePopover();
    return true;
  }
  export function toggle() {
    panel?.togglePopover();
  }
  function locate(event: ToggleEvent) {
    if (event.newState !== 'open') return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(340, innerWidth - 32);
    position = {
      left: Math.max(16, Math.min(innerWidth - width - 16, rect.right - width)),
      bottom: innerHeight - rect.top + 12
    };
  }
</script>

<svelte:window onresize={close} />
<div class="diagram-info-control">
  <button
    bind:this={button}
    class="icon-button"
    aria-label="Diagram key"
    title={`Diagram key (${shortcutLabel(SHORTCUTS.find((command) => command.id === 'info')!)})`}
    popovertarget="diagram-key"
    aria-expanded={open}><Info size={18} /></button
  >
</div>
<div
  bind:this={panel}
  id="diagram-key"
  class="diagram-key"
  popover="auto"
  role="region"
  aria-label="Diagram key"
  onbeforetoggle={locate}
  ontoggle={(event) => (open = event.newState === 'open')}
  style={`left:${position.left}px;bottom:${position.bottom}px`}
>
  <h2>Reading this view</h2>
  <div class="legend">
    <span><i></i>Current</span>
    {#if diagram?.state.proposed}<span><i class="proposed"></i>Proposed</span>{/if}
  </div>
  <p>
    {diagram?.nodes.length ?? 0} visible · {model.elements.length - (diagram?.nodes.length ?? 0)} outside
    this detail
  </p>
  {#if diagram?.state.lens === 'trust'}<div class="key-boundaries">
      {#each model.boundaries as boundary}<div>
          <strong><i style={`background:${boundary.color}`}></i>{boundary.title}</strong>
          <p>{boundary.description}</p>
        </div>{/each}
      <small>Outlines show exact membership.</small>
    </div>{/if}
  {#if diagram?.outside?.length}<button
      class="button outside-link"
      onclick={() => {
        close();
        onoutside();
      }}
    >
      {diagram.outside.length} external connections <ArrowUpRight size={12} />
    </button>{/if}
  <p class="key-hint">
    Expand + to reveal a layer. Architecture and boundaries are authored claims.
  </p>
</div>
