<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { ExternalLink, Github, Globe } from '@marcusv/roc/svelte/outline';

  let open = $state(false);
  let pinned = $state(false);
  let root: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let leaveTimer: ReturnType<typeof setTimeout>;

  function flyout(node: Element) {
    const reduced = node.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    return {
      duration: reduced ? 0 : 180,
      easing: cubicOut,
      css: (t: number) =>
        `opacity:${t};transform:translateY(${(1 - t) * 7}px) scale(${0.97 + 0.03 * t})`
    };
  }

  function links() {
    return [...root.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')];
  }

  async function openMenu(focus = false) {
    clearTimeout(leaveTimer);
    open = true;
    if (focus) {
      pinned = true;
      await tick();
      links()[0]?.focus();
    }
  }

  function closeMenu(returnFocus = false) {
    clearTimeout(leaveTimer);
    open = false;
    pinned = false;
    if (returnFocus) trigger.focus();
  }

  function toggle() {
    if (!open || !pinned) void openMenu(true);
    else closeMenu(true);
  }

  function pointerEnter(event: PointerEvent) {
    if (!pinned && event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches) {
      pinned = false;
      void openMenu();
    }
  }

  function pointerLeave(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || pinned) return;
    leaveTimer = setTimeout(() => {
      if (!root.matches(':hover') && !root.contains(document.activeElement)) closeMenu();
    }, 120);
  }

  function keydown(event: KeyboardEvent) {
    if (!open) return;
    const items = links();
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus();
    else if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items[items.length - 1]?.focus();
    else return;
    event.preventDefault();
  }

  function focusOut(event: FocusEvent) {
    if (!root.contains(event.relatedTarget as Node | null)) closeMenu();
  }

  $effect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) closeMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        if (!root.contains(document.activeElement)) closeMenu();
        return;
      }
      const returnFocus = root.contains(document.activeElement);
      event.preventDefault();
      event.stopPropagation();
      closeMenu(returnFocus);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  });

  onDestroy(() => clearTimeout(leaveTimer));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="wordmark-corner"
  class:open
  bind:this={root}
  onpointerenter={pointerEnter}
  onpointerleave={pointerLeave}
  onfocusout={focusOut}
  onkeydown={keydown}
>
  <button
    class="wordmark-trigger"
    bind:this={trigger}
    aria-label="About Fractal"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? 'fractal-wordmark-links' : undefined}
    onclick={toggle}>fractal</button
  >

  {#if open}
    <div
      id="fractal-wordmark-links"
      class="wordmark-flyout"
      role="menu"
      aria-label="Fractal links"
      transition:flyout
    >
      <p>An explorable model of software.</p>
      <a
        href="https://github.com/marcus/fractal"
        target="_blank"
        rel="noreferrer"
        role="menuitem"
        aria-label="Source on GitHub (opens in a new tab)"
        onclick={() => closeMenu()}
      >
        <span class="link-icon" aria-hidden="true"><Github size={17} /></span>
        <span class="link-copy"><strong>Source on GitHub</strong><small>marcus/fractal</small></span
        >
        <span class="external" aria-hidden="true"><ExternalLink size={13} /></span>
      </a>
      <a
        href="https://haplab.com"
        target="_blank"
        rel="noreferrer"
        role="menuitem"
        aria-label="Made by Haplab (opens in a new tab)"
        onclick={() => closeMenu()}
      >
        <span class="link-icon" aria-hidden="true"><Globe size={17} /></span>
        <span class="link-copy"><strong>Made by Haplab</strong><small>haplab.com</small></span>
        <span class="external" aria-hidden="true"><ExternalLink size={13} /></span>
      </a>
    </div>
  {/if}
</div>

<style>
  .wordmark-corner {
    position: absolute;
    right: calc(var(--float-gap) + 5px);
    bottom: var(--float-gap);
    height: var(--control-size);
    display: flex;
    align-items: center;
    z-index: 4;
  }
  .wordmark-trigger {
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ui-text, #283d34);
    font: inherit;
    font-size: 19px;
    font-weight: 585;
    letter-spacing: -0.9px;
    line-height: 1;
    opacity: 0.85;
    -webkit-user-select: none;
    user-select: none;
  }
  .wordmark-trigger:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--ui-accent, #345b46) 72%, transparent);
    outline-offset: 4px;
  }
  .wordmark-flyout {
    position: absolute;
    right: -6px;
    bottom: calc(100% + 7px);
    width: min(252px, calc(100vw - 28px));
    padding: 7px;
    border: 1px solid var(--ui-border, #dfe5dd);
    border-radius: 13px;
    background: color-mix(in srgb, var(--ui-card, #fcfdf9) 96%, transparent);
    box-shadow:
      0 18px 48px color-mix(in srgb, var(--ui-text, #283d34) 13%, transparent),
      0 2px 5px color-mix(in srgb, var(--ui-text, #283d34) 8%, transparent);
    transform-origin: bottom right;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .wordmark-flyout p {
    margin: 4px 8px 8px;
    color: var(--ui-subtle, #8c958d);
    font-size: 10.5px;
    line-height: 1.35;
    letter-spacing: 0.01em;
  }
  .wordmark-flyout a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    padding: 5px 7px;
    border-radius: 9px;
    color: var(--ui-text, #283d34);
    text-decoration: none;
  }
  .wordmark-flyout a:hover,
  .wordmark-flyout a:focus-visible {
    background: var(--ui-hover, #eaf0e5);
    outline: none;
  }
  .link-icon {
    width: 29px;
    height: 29px;
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--ui-border, #dfe5dd) 82%, transparent);
    border-radius: 8px;
    color: var(--ui-accent, #345b46);
    background: color-mix(in srgb, var(--ui-hover, #eaf0e5) 62%, transparent);
  }
  .link-copy {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }
  .link-copy strong {
    font-size: 12.5px;
    font-weight: 520;
    line-height: 1.25;
  }
  .link-copy small {
    overflow: hidden;
    color: var(--ui-subtle, #8c958d);
    font-size: 10.5px;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .external {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    color: var(--ui-subtle, #8c958d);
    opacity: 0;
    transform: translate(-2px, 2px);
    transition:
      opacity 140ms ease,
      transform 140ms ease;
  }
  .wordmark-flyout a:hover .external,
  .wordmark-flyout a:focus-visible .external {
    opacity: 1;
    transform: translate(0, 0);
  }
  @media (max-width: 760px) {
    .wordmark-corner {
      right: 14px;
      bottom: 14px;
    }
    .wordmark-trigger {
      font-size: 18px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .external {
      transition: none;
    }
  }
</style>
