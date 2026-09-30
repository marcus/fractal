<script lang="ts">
  import { SHORTCUTS, shortcutLabel } from '$lib/core/shortcuts';
  import { Info, ArrowUpRight } from '@marcusv/roc/svelte/outline';
  import { boundaryView } from '$lib/core/boundaries';
  import type { Model, Diagram } from '$lib/core/types';
  let {
    model,
    diagram,
    onoutside
  }: { model: Model; diagram: Diagram | null; onoutside: () => void } = $props();
  const boundaries = $derived(
    diagram?.state.lens === 'trust' ? boundaryView(model, diagram) : null
  );
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
  {#if boundaries}<div class="key-boundaries">
      {#each boundaries.present as entry}<div>
          <strong
            ><i class:contains={!entry.exact.length} style={`--boundary:${entry.boundary.color}`}
            ></i>{entry.boundary.title}</strong
          >
          <p>{entry.boundary.description}</p>
          {#if entry.contains.length}<p class="contains-note">
              {entry.exact.length ? 'Also contains' : 'Contains'} members inside
              {entry.contains.length === 1 ? 'a collapsed element' : 'collapsed elements'}.
            </p>{/if}
        </div>{/each}
      {#if boundaries.omitted.length}<div class="omitted">
          <strong>
            {boundaries.omitted.length}
            {boundaries.omitted.length === 1 ? 'boundary is' : 'boundaries are'} not in this view
          </strong>
          <p>{boundaries.omitted.map((boundary) => boundary.title).join(', ')}</p>
        </div>{/if}
      <small
        >Solid outlines show exact membership; dotted outlines mark a collapsed element that
        contains members.</small
      >
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
