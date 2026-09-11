/** Dismiss only a gesture that starts and ends on a native dialog's backdrop. */
export function dismissBackdrop(node: HTMLDialogElement, close: () => void) {
  let pointer: number | null = null;
  const outside = (event: PointerEvent) => {
    const box = node.getBoundingClientRect();
    return (
      event.target === node &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    );
  };
  const down = (event: PointerEvent) => {
    pointer = event.button === 0 && outside(event) ? event.pointerId : null;
  };
  const up = (event: PointerEvent) => {
    const dismiss = pointer === event.pointerId && outside(event);
    pointer = null;
    if (dismiss) close();
  };
  const cancel = () => {
    pointer = null;
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', cancel);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
    }
  };
}
