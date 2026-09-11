<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import { THEMES } from '$lib/core/themes';
  import { Paintbrush, Check } from '@marcusv/roc/svelte/outline';

  /** The palette button and its fly-out: every theme as a swatch, the current one checked. */
  let { theme, onchoose }: { theme: string; onchoose: (id: string) => void } = $props();
  let open = $state(false);
  let root: HTMLDivElement;
  let trigger: HTMLButtonElement;

  function flyout(node: Element) {
    const reduced = node.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    return {
      duration: reduced ? 0 : 180,
      easing: cubicOut,
      css: (t: number) =>
        `opacity:${t};transform:translateY(${(1 - t) * -6}px) scale(${0.97 + 0.03 * t})`
    };
  }
  function choose(id: string) {
    onchoose(id);
    open = false;
    trigger.focus();
  }
  function keydown(e: KeyboardEvent) {
    if (!open) return;
    const items = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      open = false;
      trigger.focus();
    } else if (e.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else return;
    e.preventDefault();
  }
  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) open = false;
    };
    document.addEventListener('pointerdown', outside, true);
    requestAnimationFrame(() =>
      root.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    );
    return () => document.removeEventListener('pointerdown', outside, true);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="theme-menu" bind:this={root} onkeydown={keydown}>
  <button
    class="icon-button"
    class:active={open}
    bind:this={trigger}
    title="Theme"
    aria-label="Theme"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}><Paintbrush size={17} /></button
  >
  {#if open}
    <div class="theme-flyout" role="menu" aria-label="Theme" transition:flyout>
      {#each THEMES as item}
        <button
          role="menuitemradio"
          aria-checked={item.id === theme}
          onclick={() => choose(item.id)}
        >
          <i
            class="swatch"
            style={`background:${item.canvas};border-color:${item.border};--swatch-accent:${item.accent};--swatch-text:${item.text}`}
          ></i>
          <span><strong>{item.name}</strong><small>{item.description}</small></span>
          {#if item.id === theme}<Check size={14} />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .theme-menu {
    position: relative;
  }
  .icon-button.active {
    background: var(--ui-hover, #eaf0e5);
    color: var(--ui-text, #283d34);
  }
  .theme-flyout {
    position: absolute;
    top: calc(100% + 8px);
    right: -2px;
    width: 256px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--ui-card, #fcfdf9);
    border: 1px solid var(--ui-border, #dfe5dd);
    border-radius: 12px;
    box-shadow:
      0 16px 44px #10251a1c,
      0 1px 3px #10251a12;
    transform-origin: top right;
    z-index: 20;
  }
  .theme-flyout button {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 8px 10px 8px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    color: var(--ui-text, #283d34);
  }
  .theme-flyout button:hover,
  .theme-flyout button:focus-visible {
    background: var(--ui-hover, #eaf0e5);
    outline: none;
  }
  .theme-flyout button[aria-checked='true'] {
    color: var(--ui-accent, #345b46);
  }
  .theme-flyout span {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .theme-flyout strong {
    font-size: 12.5px;
    font-weight: 500;
  }
  .theme-flyout small {
    font-size: 10.5px;
    line-height: 1.35;
    color: var(--ui-subtle, #8b9584);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .swatch {
    position: relative;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border: 1px solid;
    border-radius: 8px;
    overflow: hidden;
  }
  .swatch::before {
    content: '';
    position: absolute;
    left: 6px;
    top: 7px;
    width: 9px;
    height: 3px;
    border-radius: 2px;
    background: var(--swatch-text);
    opacity: 0.8;
  }
  .swatch::after {
    content: '';
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--swatch-accent);
  }
</style>
