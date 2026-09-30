import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { loadDirectory } from '../src/lib/server/models';
import { layout } from '../src/lib/core/layout';
import { textWidth } from '../src/lib/core/projection';
import { exportSvg } from '../src/lib/core/svg';
import type { Diagram, LayoutEdge } from '../src/lib/core/types';

function assertAttached(diagram: Diagram) {
  const ports = new Set(diagram.nodes.filter((node) => node.port).map((node) => node.id));
  const portEdges = diagram.edges.filter(
    (edge) => ports.has(edge.source) || ports.has(edge.target)
  );
  assert.ok(portEdges.length >= 9);
  for (const edge of portEdges) {
    const width = Math.max(...edge.labelLines.map((line) => textWidth(line, 11))) + 14;
    const box = {
      left: edge.label.x - width / 2,
      right: edge.label.x + width / 2,
      top: edge.label.y - 13,
      bottom: edge.label.y - 13 + edge.labelLines.length * 15 + 8
    };
    const intersects = (route: LayoutEdge) =>
      route.points.some((point, i) => {
        if (!i) return false;
        const before = route.points[i - 1];
        return Math.abs(point.y - before.y) < 0.5
          ? point.y > box.top &&
              point.y < box.bottom &&
              Math.max(point.x, before.x) > box.left &&
              Math.min(point.x, before.x) < box.right
          : Math.abs(point.x - before.x) < 0.5 &&
              point.x > box.left &&
              point.x < box.right &&
              Math.max(point.y, before.y) > box.top &&
              Math.min(point.y, before.y) < box.bottom;
      });
    assert.ok(intersects(edge), `${edge.id}: label must sit on its own route`);
    assert.deepEqual(
      diagram.edges
        .filter((other) => other.id !== edge.id && intersects(other))
        .map((other) => other.id),
      [],
      `${edge.id}: another route must not run under its label`
    );
  }
  return portEdges;
}

for (const engine of ['elk-layered', 'elk-layered-down'] as const) {
  for (const incoming of [false, true]) {
    test(`port labels stay attached and unambiguous: ${engine}, ${incoming ? 'incoming' : 'outgoing'}`, async () => {
      const { model } = structuredClone(await loadDirectory(resolve('tests/fixtures/port-labels')));
      if (incoming)
        model.relationships = model.relationships.map((edge) =>
          edge.target.startsWith('bakery.')
            ? edge
            : { ...edge, source: edge.target, target: edge.source }
        );
      const diagram = await layout(model, { ...model.scenes[0], layout: engine });
      const edges = assertAttached(diagram);
      const svg = exportSvg(model, diagram);
      for (const edge of edges)
        assert.ok(svg.includes(`x="${edge.label.x}" y="${edge.label.y}" text-anchor="middle"`));
    });
  }
}

test('twenty distinct cross-scope claims keep individually attached labels', async () => {
  const { model } = structuredClone(await loadDirectory(resolve('tests/fixtures/port-labels')));
  const outside = model.relationships.filter((edge) => !edge.target.startsWith('bakery.'));
  for (let i = outside.length; i < 20; i++)
    model.relationships.push({
      ...outside[i % outside.length],
      id: `extra-${i}`,
      title: `Records additional production measurement ${i}`
    });
  assert.equal(assertAttached(await layout(model, model.scenes[0])).length, 20);
});
