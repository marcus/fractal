import { kindTitle } from './kind-icons';
import { ARCHITECTURE_NODE_METRICS as METRICS } from './node-metrics';
import { textWidth, wrapText } from './projection';
import type { MeasuredEdge, MeasuredGraph, MeasuredNode } from './layout-engine';
import type { Projection } from './types';

/** Width of the text budget an edge label wraps into, and its type size. */
export const EDGE_LABEL_WIDTH = 112;
export const EDGE_LABEL_SIZE = 11;

/**
 * Measure every visible node and edge before layout. Sizes come from the shared density profile
 * and the same text fitting the canvas and export draw with, so an engine only decides where
 * things go, never how big they are.
 */
export function measure(projection: Projection): MeasuredGraph {
  const expanded = new Set(projection.expanded);
  const nodes: MeasuredNode[] = [];
  const visit = (parent: string | null, depth: number): void => {
    for (const element of projection.elements) {
      if (element.parent !== parent) continue;
      const open = expanded.has(element.id);
      const width = Math.max(
        METRICS.collapsed.minWidth,
        Math.min(METRICS.collapsed.maxWidth, textWidth(element.title, METRICS.titleSize) + 44)
      );
      const titleLines = wrapText(
        element.title,
        width - (open ? METRICS.expandedTitleWidthInset : METRICS.collapsed.titleWidthInset),
        METRICS.titleSize
      );
      const descriptionLines = open
        ? []
        : wrapText(element.description, width - METRICS.collapsed.descriptionWidthInset, 12);
      const headerHeight = Math.max(
        METRICS.expandedHeaderMin,
        METRICS.expandedHeaderBase + titleLines.length * METRICS.titleLineHeight
      );
      const height = open
        ? headerHeight + METRICS.expandedBodyExtra
        : Math.max(
            METRICS.collapsed.minHeight,
            METRICS.collapsed.heightBase + titleLines.length * 21 + descriptionLines.length * 17
          );
      nodes.push({
        ...element,
        depth,
        expanded: open,
        width,
        height,
        headerHeight,
        titleLines,
        descriptionLines,
        kindLabel: kindTitle(element.kind, element.status)
      });
      if (open) visit(element.id, depth + 1);
    }
  };
  visit(null, 0);
  const edges: MeasuredEdge[] = projection.edges.map((edge) => {
    const labelLines = wrapText(
      `${edge.title}${edge.underlying.length > 1 ? ` ×${edge.underlying.length}` : ''}`,
      EDGE_LABEL_WIDTH,
      EDGE_LABEL_SIZE
    );
    return {
      ...edge,
      labelLines,
      labelWidth: labelLines.length
        ? Math.max(...labelLines.map((line) => textWidth(line, EDGE_LABEL_SIZE))) + 14
        : 0,
      labelHeight: labelLines.length ? labelLines.length * 15 + 10 : 0
    };
  });
  return { nodes, edges };
}
