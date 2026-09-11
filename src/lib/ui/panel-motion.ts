import { cubicOut } from 'svelte/easing';

/** A floating card fades in and settles. Reads the motion preference at each transition. */
export function panelMotion(node: Element) {
  const reduced = node.ownerDocument.defaultView?.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;
  return {
    duration: reduced ? 0 : 220,
    easing: cubicOut,
    css: (t: number) => `opacity:${t};transform:translateY(${(1 - t) * -8}px)`
  };
}
