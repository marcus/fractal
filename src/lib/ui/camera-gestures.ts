// Pointer and wheel arithmetic for the diagram cameras. Both canvases share one camera shape,
// `{ x, y, zoom }`, where x/y are screen offsets from the centre of the fit region and zoom is
// relative to the fitted overview. Everything here is state-free so the two canvases only own
// the event wiring.

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Zoom about a screen point: the world point under `origin` (measured from the fit centre) stays
 * put while the zoom changes from `camera.zoom` to `zoom`.
 */
export function zoomAbout(camera: Camera, origin: Point, zoom: number): Camera {
  const ratio = zoom / camera.zoom;
  return {
    zoom,
    x: origin.x - (origin.x - camera.x) * ratio,
    y: origin.y - (origin.y - camera.y) * ratio
  };
}

export interface WheelLike {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

/* Firefox reports mouse wheels in lines rather than pixels; page mode is a full screen. */
const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;
/* One mouse notch is ~100px in Chromium, giving a comfortable 16% step. */
const WHEEL_RATE = 0.0015;
/* Trackpad pinch arrives as ctrl+wheel with deltas an order of magnitude smaller per event. */
const PINCH_RATE = 0.012;

/** The multiplicative zoom change a wheel event asks for. */
export function wheelZoomRatio(e: WheelLike): number {
  const pixels =
    e.deltaMode === 1
      ? e.deltaY * LINE_PIXELS
      : e.deltaMode === 2
        ? e.deltaY * PAGE_PIXELS
        : e.deltaY;
  return Math.exp(-pixels * (e.ctrlKey ? PINCH_RATE : WHEEL_RATE));
}

export interface Pinch {
  camera: Camera;
  /* Screen positions of the two pointers when the pinch began. */
  a: Point;
  b: Point;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The zoom a pinch has reached, relative to where it began. */
export function pinchZoom(pinch: Pinch, a: Point, b: Point): number {
  const start = distance(pinch.a, pinch.b);
  return start < 1 ? pinch.camera.zoom : (pinch.camera.zoom * distance(a, b)) / start;
}

/**
 * The camera for two pointers now at `a` and `b`: the world point that sat under the starting
 * midpoint follows the current midpoint, so a pinch pans and zooms at once. `zoom` is passed in
 * so the caller can clamp it before the pan is derived.
 */
export function pinchCamera(pinch: Pinch, a: Point, b: Point, zoom: number): Camera {
  const from = midpoint(pinch.a, pinch.b);
  const to = midpoint(a, b);
  const ratio = zoom / pinch.camera.zoom;
  return {
    zoom,
    x: to.x - (from.x - pinch.camera.x) * ratio,
    y: to.y - (from.y - pinch.camera.y) * ratio
  };
}
