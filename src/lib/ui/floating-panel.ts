import { PANEL_MIN_HEIGHT, type PanelOffset } from './preferences';

export type Insets = { left: number; right: number; top: number; bottom: number };
const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * How much of the canvas the floating chrome covers on each side, measured from the live DOM.
 * Canvases fit diagrams into the uncovered area and reveal selections clear of the panels.
 */
export function floatingInsets(options: { navigationHidden: boolean }): Insets {
  if (typeof document === 'undefined') return NO_INSETS;
  const area = document.querySelector('.diagram-area')?.getBoundingClientRect();
  if (!area) return NO_INSETS;
  const gap = 12;
  const nav = options.navigationHidden
    ? null
    : document.getElementById('fractal-sidebar')?.getBoundingClientRect();
  const inspector = document.querySelector('.inspector-shell')?.getBoundingClientRect();
  const bar = document.querySelector('.appbar')?.getBoundingClientRect();
  const covered = (edge: number) => Math.min(Math.max(0, edge), area.width / 2);
  return {
    left: nav?.width ? covered(nav.right - area.left + gap) : 0,
    right: inspector?.width ? covered(area.right - inspector.left + gap) : 0,
    // The bar floats over the top of the canvas; keep fitted diagrams below it.
    top: bar ? Math.min(Math.max(0, bar.bottom - area.top), area.height / 3) : 0,
    bottom: 0
  };
}

export type FloatingPanelOptions = {
  oncollapse?: () => void;
  /** Where a previous drag left the panel; applied on mount, clamped to the studio. */
  initialOffset?: PanelOffset | null;
  /** Called when a drag ends, with the panel's offset from its laid-out place. */
  onmove?: (offset: PanelOffset) => void;
};

/**
 * Drag a floating studio panel by its grip (`[data-panel-grip]`). The layout places panels
 * where a reader rarely needs to move them; a drag nudges one aside. Owners that pass
 * `initialOffset` and `onmove` keep that nudge as personal chrome so the panel comes back
 * where it was left; otherwise a reload puts it back. A double-click on the grip folds the panel
 * up. The offset lives in the CSS `translate` property so it composes with the collapse
 * motion's `transform`.
 */
export function floatingPanel(node: HTMLElement, options: FloatingPanelOptions = {}) {
  let offset = { x: 0, y: 0 };
  let drag: { x: number; y: number; ox: number; oy: number; id: number } | null = null;

  const onGrip = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('[data-panel-grip]')) &&
    !target.closest('button');
  /** Panels move only where the grip shows: the sheet layout below 761px keeps them put. */
  const movable = () => {
    const grip = node.querySelector<HTMLElement>('[data-panel-grip]');
    return Boolean(grip && getComputedStyle(grip).display !== 'none');
  };

  function apply() {
    node.style.translate = offset.x || offset.y ? `${offset.x}px ${offset.y}px` : '';
  }
  /**
   * Keep enough of the panel inside the studio to grab it again. Offset geometry ignores
   * `translate` and transforms, so this holds during the intro motion and after a restore.
   */
  function clamp(x: number, y: number) {
    const bounds = node.offsetParent;
    if (!bounds) return { x, y };
    const baseLeft = node.offsetLeft;
    const baseTop = node.offsetTop;
    return {
      x: Math.max(
        -baseLeft - node.offsetWidth + 72,
        Math.min(bounds.clientWidth - baseLeft - 72, x)
      ),
      y: Math.max(-baseTop, Math.min(bounds.clientHeight - baseTop - 48, y))
    };
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 || !onGrip(e.target)) return;
    drag = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, id: e.pointerId };
    node.setPointerCapture(e.pointerId);
    node.classList.add('panel-dragging');
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    offset = clamp(drag.ox + e.clientX - drag.x, drag.oy + e.clientY - drag.y);
    apply();
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    node.classList.remove('panel-dragging');
    options.onmove?.({ ...offset });
  }
  // Double-clicking the grip folds the panel up to its title (and unfolds it again). The panel
  // stays where it was dragged.
  function collapse(e: MouseEvent) {
    // Pointer capture retargets the click to the panel; test what is under the cursor instead.
    if (!onGrip(document.elementFromPoint(e.clientX, e.clientY))) return;
    options.oncollapse?.();
  }
  // A smaller window must not strand a restored or dragged panel off the studio.
  function resize() {
    if (!offset.x && !offset.y) return;
    offset = clamp(offset.x, offset.y);
    apply();
  }

  if (options.initialOffset && movable()) {
    offset = clamp(options.initialOffset.x, options.initialOffset.y);
    apply();
  }
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('dblclick', collapse);
  window.addEventListener('resize', resize);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('dblclick', collapse);
      window.removeEventListener('resize', resize);
    }
  };
}

export type PanelResizeOptions = {
  /** Which dimensions this handle changes. */
  axes: 'x' | 'y' | 'xy';
  /** The panel edge the handle sits on; the panel grows as that edge moves outward. */
  xEdge?: 'left' | 'right';
  /** A saved height to apply on mount; only the primary height handle passes one. */
  initialHeight?: number | null;
  onheight?: (height: number | null) => void;
  onwidth?: (width: number, phase: 'move' | 'end') => void;
};

/**
 * Resize a floating panel from an edge or a corner. The handle is a child of the panel. Height
 * is applied here as `--panel-height` plus `.panel-sized` on the panel, since every panel
 * treats it the same way; width goes back to the owner through `onwidth`, because navigation
 * and inspector store and apply theirs differently. Double-click, or End, on the height handle
 * returns the panel to hugging its content. Arrow keys step whichever dimension a handle owns.
 */
export function panelResizer(node: HTMLElement, options: PanelResizeOptions) {
  const panel = () => node.parentElement as HTMLElement;
  const wantsX = options.axes !== 'y';
  const wantsY = options.axes !== 'x';
  let drag: { id: number; x: number; y: number; width: number; height: number } | null = null;
  const clampHeight = (height: number) => Math.max(PANEL_MIN_HEIGHT, Math.round(height));
  const rendered = () => panel().getBoundingClientRect();

  function applyHeight(height: number | null) {
    const target = panel();
    if (height === null) {
      target.style.removeProperty('--panel-height');
      target.classList.remove('panel-sized');
    } else {
      target.style.setProperty('--panel-height', `${clampHeight(height)}px`);
      target.classList.add('panel-sized');
    }
  }
  function commitHeight(height: number | null) {
    applyHeight(height);
    options.onheight?.(height === null ? null : clampHeight(rendered().height));
  }
  function commitWidth(width: number) {
    options.onwidth?.(width, 'move');
    options.onwidth?.(rendered().width, 'end');
  }
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    const rect = rendered();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
    node.setPointerCapture(e.pointerId);
    panel().classList.add('panel-resizing');
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (wantsY) applyHeight(drag.height + e.clientY - drag.y);
    if (wantsX) {
      const dx = e.clientX - drag.x;
      options.onwidth?.(drag.width + (options.xEdge === 'left' ? -dx : dx), 'move');
    }
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    panel().classList.remove('panel-resizing');
    if (wantsY) commitHeight(rendered().height);
    if (wantsX) options.onwidth?.(rendered().width, 'end');
  }
  function reset() {
    if (wantsY) commitHeight(null);
  }
  function keydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 96 : 24;
    const outward = options.xEdge === 'left' ? -1 : 1;
    if (wantsY && e.key === 'ArrowUp') commitHeight(rendered().height - step);
    else if (wantsY && e.key === 'ArrowDown') commitHeight(rendered().height + step);
    else if (wantsY && e.key === 'Home') commitHeight(PANEL_MIN_HEIGHT);
    else if (wantsY && e.key === 'End') commitHeight(null);
    else if (wantsX && e.key === 'ArrowLeft') commitWidth(rendered().width - step * outward);
    else if (wantsX && e.key === 'ArrowRight') commitWidth(rendered().width + step * outward);
    else return;
    e.preventDefault();
  }

  if (options.initialHeight !== undefined) applyHeight(options.initialHeight);
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('dblclick', reset);
  node.addEventListener('keydown', keydown);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('dblclick', reset);
      node.removeEventListener('keydown', keydown);
    }
  };
}
