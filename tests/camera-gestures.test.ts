import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pinchCamera,
  pinchZoom,
  wheelZoomRatio,
  zoomAbout,
  type Camera,
  type Point
} from '../src/lib/ui/camera-gestures';

function toScreen(camera: Camera, world: Point): Point {
  return { x: camera.x + world.x * camera.zoom, y: camera.y + world.y * camera.zoom };
}

test('zoomAbout keeps the world point under the pointer fixed', () => {
  const camera = { x: 40, y: -20, zoom: 1.5 };
  const origin = { x: 120, y: 80 };
  const world = { x: (origin.x - camera.x) / camera.zoom, y: (origin.y - camera.y) / camera.zoom };
  const next = zoomAbout(camera, origin, 3);
  assert.equal(next.zoom, 3);
  const after = toScreen(next, world);
  assert.ok(Math.abs(after.x - origin.x) < 1e-9 && Math.abs(after.y - origin.y) < 1e-9);
});

test('a mouse notch keeps its 16% step and pinch deltas are stronger', () => {
  const notch = wheelZoomRatio({ deltaY: -100, deltaMode: 0, ctrlKey: false });
  assert.ok(Math.abs(notch - Math.exp(0.15)) < 1e-12);
  const pinch = wheelZoomRatio({ deltaY: -100, deltaMode: 0, ctrlKey: true });
  assert.ok(pinch > notch * 2, 'trackpad pinch must not crawl');
  // A typical trackpad pinch step is a handful of pixels; it should still be felt.
  assert.ok(wheelZoomRatio({ deltaY: -5, deltaMode: 0, ctrlKey: true }) > 1.05);
  assert.ok(wheelZoomRatio({ deltaY: 100, deltaMode: 0, ctrlKey: false }) < 1);
});

test('line-mode wheels are scaled to a comparable pixel distance', () => {
  const lines = wheelZoomRatio({ deltaY: -3, deltaMode: 1, ctrlKey: false });
  const pixels = wheelZoomRatio({ deltaY: -48, deltaMode: 0, ctrlKey: false });
  assert.ok(Math.abs(lines - pixels) < 1e-12);
});

test('pinch zoom follows the finger spread and pans with the midpoint', () => {
  const pinch = {
    camera: { x: 10, y: 20, zoom: 2 },
    a: { x: 100, y: 100 },
    b: { x: 200, y: 100 }
  };
  const a = { x: 80, y: 150 },
    b = { x: 280, y: 150 };
  const zoom = pinchZoom(pinch, a, b);
  assert.equal(zoom, 4);
  const next = pinchCamera(pinch, a, b, zoom);
  const startMid = { x: 150, y: 100 };
  const world = {
    x: (startMid.x - pinch.camera.x) / pinch.camera.zoom,
    y: (startMid.y - pinch.camera.y) / pinch.camera.zoom
  };
  const after = toScreen(next, world);
  assert.deepEqual(after, { x: 180, y: 150 });
});

test('a clamped pinch zoom still pans to the midpoint', () => {
  const pinch = { camera: { x: 0, y: 0, zoom: 1 }, a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
  const next = pinchCamera(pinch, { x: 50, y: 50 }, { x: 550, y: 50 }, 3);
  assert.equal(next.zoom, 3);
  // Start midpoint (50, 0) at zoom 1 is world (50, 0); it lands at the new midpoint (300, 50).
  assert.deepEqual(toScreen(next, { x: 50, y: 0 }), { x: 300, y: 50 });
});

test('fingers that begin together do not divide by zero', () => {
  const pinch = { camera: { x: 0, y: 0, zoom: 2 }, a: { x: 5, y: 5 }, b: { x: 5, y: 5 } };
  assert.equal(pinchZoom(pinch, { x: 0, y: 0 }, { x: 100, y: 0 }), 2);
});
