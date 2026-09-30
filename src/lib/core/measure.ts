import { kindTitle } from './kind-icons';
import {
  ARCHITECTURE_NODE_METRICS as METRICS,
  EDGE_LABEL_SIZE,
  EDGE_LABEL_WIDTH
} from './node-metrics';
import { compositionPortLabelLines, compositionPortSize } from '../composition/ports';
import { fitTitleSize, textWidth, wrapText } from './projection';
import type { MeasuredEdge, MeasuredGraph, MeasuredNode } from './layout-engine';
import type { Projection } from './types';

export { EDGE_LABEL_SIZE, EDGE_LABEL_WIDTH };

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
      const titleInset = open ? METRICS.expandedTitleWidthInset : METRICS.collapsed.titleWidthInset;
      // A long identifier widens its card to sit on one line before it wraps or shrinks.
      const width = Math.max(
        METRICS.collapsed.minWidth,
        Math.min(
          METRICS.collapsed.maxWidth,
          Math.max(
            textWidth(element.title, METRICS.titleSize) + 44,
            Math.max(
              0,
              ...element.title.split(/\s+/).map((word) => textWidth(word, METRICS.titleSize))
            ) + titleInset
          )
        )
      );
      const titleSize = fitTitleSize(element.title, width - titleInset, METRICS.titleSize);
      const titleLines = wrapText(element.title, width - titleInset, titleSize);
      const descriptionLines = open
        ? []
        : wrapText(
            element.summary?.trim() || element.description,
            width - METRICS.collapsed.descriptionWidthInset,
            12
          );
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
        ...(titleSize === METRICS.titleSize ? {} : { titleSize }),
        descriptionLines,
        kindLabel: kindTitle(element.kind, element.status)
      });
      if (open) visit(element.id, depth + 1);
    }
  };
  visit(null, 0);
  // Outside endpoints of a scoped view: the same port card a linked composition draws.
  for (const port of projection.ports ?? []) {
    const labelLines = compositionPortLabelLines(port.title);
    const size = compositionPortSize(labelLines);
    nodes.push({
      id: port.id,
      sourceId: port.element,
      parent: null,
      title: port.title,
      kind: port.kind,
      description: '',
      technology: '',
      status: 'current',
      color: port.color,
      evidence: [],
      port: { element: port.element, connections: port.connections, flow: port.flow },
      depth: 0,
      expanded: false,
      width: size.width,
      height: size.height,
      headerHeight: 0,
      titleLines: labelLines,
      descriptionLines: [],
      kindLabel: kindTitle(port.kind, 'current')
    });
  }
  const edges: MeasuredEdge[] = projection.edges.map((edge) => {
    const labelLines = wrapText(
      `${edge.title}${edge.underlying.length > 1 && !edge.rollup ? ` ×${edge.underlying.length}` : ''}`,
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
