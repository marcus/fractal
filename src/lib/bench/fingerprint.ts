import { createHash } from 'node:crypto';
import type { Diagram } from '../core/types';

/** Coordinates are compared at 0.01: finer than any visible difference, coarser than float noise. */
const fixed = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return (rounded === 0 ? 0 : rounded).toFixed(2);
};

/**
 * Code-unit order, not `localeCompare`: collation depends on the host's locale and ICU build, and
 * a fingerprint has to mean the same thing on every machine that compares one.
 */
const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Every node and edge coordinate of a laid-out diagram, in a deterministic order.
 * Exposed separately from the hash so a differing fingerprint can be explained line by line.
 */
export function geometryLines(diagram: Diagram): string[] {
  const nodes = [...diagram.nodes]
    .sort(byId)
    .map(
      (node) =>
        `node ${node.id} ${fixed(node.x)} ${fixed(node.y)} ${fixed(node.width)} ${fixed(node.height)}`
    );
  const edges = [...diagram.edges]
    .sort(byId)
    .map(
      (edge) =>
        `edge ${edge.id} ${edge.points.map((point) => `${fixed(point.x)},${fixed(point.y)}`).join(' ')} label ${fixed(edge.label.x)},${fixed(edge.label.y)}`
    );
  return [...nodes, ...edges, `diagram ${fixed(diagram.width)} ${fixed(diagram.height)}`];
}

/** Identical fingerprints prove an optimization changed nothing visible. */
export function geometryFingerprint(diagram: Diagram): string {
  return createHash('sha256').update(geometryLines(diagram).join('\n')).digest('hex');
}
