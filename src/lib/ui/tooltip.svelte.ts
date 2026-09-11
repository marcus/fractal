/**
 * One delayed tooltip for the whole studio. Triggers register through the `tip` action, which
 * works on HTML and SVG elements alike; TooltipHost renders whichever tip is current. Tips are a
 * courtesy for pointer users: every trigger keeps its own accessible name and the host is linked
 * through aria-describedby only while it shows.
 */
export interface TipContent {
  title?: string;
  text: string;
}

export const TOOLTIP_ID = 'fractal-tooltip';
export const TOOLTIP_DELAY = 480;

let current = $state<{ content: TipContent; rect: DOMRect } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let owner: Element | null = null;

export const tooltip = {
  get current() {
    return current;
  },
  show(element: Element, content: TipContent, delay = TOOLTIP_DELAY) {
    tooltip.hide();
    owner = element;
    timer = setTimeout(() => {
      if (!element.isConnected) return;
      current = { content, rect: element.getBoundingClientRect() };
      element.setAttribute('aria-describedby', TOOLTIP_ID);
    }, delay);
  },
  hide() {
    clearTimeout(timer);
    timer = undefined;
    owner?.removeAttribute('aria-describedby');
    owner = null;
    current = null;
  }
};

/** Attach a delayed tooltip to any element: `use:tip={{ title, text }}`. */
export function tip(node: Element, content: TipContent | null) {
  let value = content;
  const enter = () => value && tooltip.show(node, value);
  const leave = () => owner === node && tooltip.hide();
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('pointerdown', leave);
  node.addEventListener('focus', enter);
  node.addEventListener('blur', leave);
  return {
    update(next: TipContent | null) {
      value = next;
    },
    destroy() {
      leave();
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointerdown', leave);
      node.removeEventListener('focus', enter);
      node.removeEventListener('blur', leave);
    }
  };
}
