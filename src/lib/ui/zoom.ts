// Zoom is relative to the fitted overview. Large diagrams need extra range so
// their text can still reach the same magnification as a small diagram.
export function maximumCanvasZoom(fitScale: number): number {
  return Math.max(35, 35 / Math.max(0.001, fitScale));
}
