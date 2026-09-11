<script lang="ts">
  import { dismissBackdrop } from '$lib/ui/dismiss-backdrop';
  import { onMount } from 'svelte';
  import { SHORTCUTS, shortcutLabel, shortcutKeys, shortcutsForSurface } from '$lib/core/shortcuts';
  let {
    presentation = false,
    surface = 'architecture',
    onclose
  }: {
    presentation?: boolean;
    surface?: 'architecture' | 'sequence' | 'portable';
    onclose: () => void;
  } = $props();
  const mode = $derived(presentation ? 'presentation' : 'studio');
  const commands = $derived(
    shortcutsForSurface(surface).filter((command) => shortcutKeys(command, mode).length)
  );
  let dialog: HTMLDialogElement;
  let mac = $state(false);
  const keysFor = (id: string) =>
    shortcutLabel(
      SHORTCUTS.find((s) => s.id === id)!,
      mac
    );
  const groups = $derived([...new Set(commands.map((s) => s.group))]);
  onMount(() => {
    mac = /Mac|iPhone|iPad/.test(navigator.platform);
    dialog.showModal();
    return () => dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  use:dismissBackdrop={onclose}
  class="navigation-dialog shortcut-sheet"
  aria-labelledby="shortcuts-title"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  <!-- No close control: Escape and a click outside dismiss the sheet, and the footer says so. -->
  <header>
    <h2 id="shortcuts-title">{presentation ? 'Presentation shortcuts' : 'Keyboard shortcuts'}</h2>
  </header>
  <p class="shortcut-note">
    {#if surface === 'portable'}
      Explore perspectives and sequences, inspect a selection with Enter, and fold or unfold it with
      Space. Use the same keys on the canvas as in the studio.
    {:else if surface === 'sequence'}
      In presentation, left/right arrows change journeys. HJKL or WASD move through participants and
      interactions. Space folds a phase or participant group; Enter selects it.
    {:else}
      In presentation, {keysFor('previous-scene')} / {keysFor('next-scene')} change views. Component movement
      stays in the current view; {keysFor('outward')} moves outward without ending the presentation.
    {/if}
  </p>
  <div class="shortcut-groups">
    {#each groups as group}<section>
        <h3>{group}</h3>
        {#each commands.filter((s) => s.group === group) as shortcut}<div class="shortcut-row">
            <span>{shortcut.label}</span><span class="shortcut-keys"
              >{#each shortcutKeys(shortcut, mode) as key}<kbd>{shortcutLabel(key, mac)}</kbd
                >{/each}</span
            >
          </div>{/each}
      </section>{/each}
  </div>
  <footer><span>Text fields and native controls keep their own keys.</span><kbd>esc</kbd></footer>
</dialog>
