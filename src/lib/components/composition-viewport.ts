import { ARCHITECTURE_NODE_METRICS } from '$lib/core/node-metrics';
import type { Point } from '$lib/core/types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Body copy paints at 12px on the canvas. Titles use the shared architecture metric (14px).
 * Secondary labels (bridges) paint at 11px. These sizes are CSS-only; layout still measures
 * the full strings.
 */
export const DESCRIPTION_PAINT_SIZE = 12;
export const SECONDARY_LABEL_PAINT_SIZE = 11;

/**
 * On-screen size below which body text is no longer worth drawing. Taken from the architecture
 * title size so the threshold moves with the metric profile rather than a magic camera zoom.
 */
export const MIN_READABLE_PAINT_SIZE = ARCHITECTURE_NODE_METRICS.titleSize - 5;

/** Camera scale at which descriptions and secondary labels are omitted (CSS/DOM only). */
export const LOW_ZOOM_DETAIL_SCALE = MIN_READABLE_PAINT_SIZE / ARCHITECTURE_NODE_METRICS.titleSize;

/** Extra viewports of geometry kept around the visible camera in each direction. */
export const CULL_OVERSCAN_VIEWPORTS = 1;

/** Inflate route AABBs so a zero-width polyline still intersects the cull rect. */
export const ROUTE_BOUNDS_PAD = 8;

/** Map the screen camera onto composed/world coordinates. */
export function worldViewFromCamera(
  transform: { x: number; y: number; scale: number },
  size: { width: number; height: number }
): Rect {
  const scale = transform.scale || 1;
  return {
    x: -transform.x / scale,
    y: -transform.y / scale,
    width: size.width / scale,
    height: size.height / scale
  };
}

/** Expand a view by `viewports` extra viewports on every side. */
export function overscanRect(view: Rect, viewports = CULL_OVERSCAN_VIEWPORTS): Rect {
  return {
    x: view.x - view.width * viewports,
    y: view.y - view.height * viewports,
    width: view.width * (1 + 2 * viewports),
    height: view.height * (1 + 2 * viewports)
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Axis-aligned bounds of a polyline, including edges whose endpoints sit outside the
 * viewport but whose path still crosses it.
 */
export function routeBounds(points: readonly Point[], pad = ROUTE_BOUNDS_PAD): Rect {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(0, maxX - minX) + pad * 2,
    height: Math.max(0, maxY - minY) + pad * 2
  };
}

export function isLowZoom(scale: number): boolean {
  return scale < LOW_ZOOM_DETAIL_SCALE;
}
