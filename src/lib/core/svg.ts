import { textWidth, truncateText, wrapText } from './projection';
import type { Diagram, LayoutNode, Model } from './types';
import { getTheme } from './themes';
import { ARCHITECTURE_NODE_METRICS as METRICS } from './node-metrics';
import { kindIcon } from './kind-icons';

const xml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
  );
const number = (value: number): string => Number(value.toFixed(3)).toString();

/**
 * Shared scalar formatters for SVG exporters. The single-model renderer above keeps its
 * private copies so its bytes cannot drift; the composition exporter uses these.
 */
export const escapeXml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
  );
export const formatSvgNumber = (value: number): string => Number(value.toFixed(3)).toString();
const color = (value: string): string => (/^#[\da-f]{3,8}$/i.test(value) ? value : '#557b70');
const lines = (
  values: string[],
  x: number,
  y: number,
  size: number,
  leading: number,
  fill: string,
  weight = 400
): string =>
  `<text x="${number(x)}" y="${number(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${values.map((line, index) => `<tspan x="${number(x)}" dy="${index ? leading : 0}">${xml(line)}</tspan>`).join('')}</text>`;

function boundedLines(text: string, width: number, size: number, limit: number): string[] {
  const wrapped = wrapText(text, width, size);
  if (wrapped.length <= limit) return wrapped;
  const visible = wrapped.slice(0, limit);
  visible[limit - 1] = truncateText(visible[limit - 1] + '…', width, size);
  return visible;
}

/** Portable slide: all typography and artwork are embedded SVG, without foreignObject or remote resources. */
export function exportSvg(
  model: Model,
  diagram: Diagram,
  options: { title?: string; subtitle?: string } = {}
): string {
  const theme = getTheme(diagram.state.theme);
  const titleLines = boundedLines(options.title ?? model.title, 1728, 48, 2);
  const subtitleLines = boundedLines(options.subtitle ?? model.description, 1728, 19, 3);
  const legends =
    diagram.state.lens === 'trust'
      ? model.boundaries.filter((boundary) =>
          diagram.nodes.some((node) => boundary.members.includes(node.id))
        )
      : [];
  const headerBottom = 92 + titleLines.length * 54 + subtitleLines.length * 26 + 38;
  const area = {
    x: 96,
    y: headerBottom,
    width: 1728,
    height: (legends.length ? 920 : 968) - headerBottom
  };
  // Include decorative member outlines in the fit bounds, even for many memberships.
  const bounds = { left: 0, top: 0, right: diagram.width, bottom: diagram.height };
  for (const node of diagram.nodes) {
    const extent = legends.filter((boundary) => boundary.members.includes(node.id)).length * 4 + 2;
    bounds.left = Math.min(bounds.left, node.x - extent);
    bounds.top = Math.min(bounds.top, node.y - extent);
    bounds.right = Math.max(bounds.right, node.x + node.width + extent);
    bounds.bottom = Math.max(bounds.bottom, node.y + node.height + extent);
  }
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const scale = Math.min(area.width / Math.max(1, width), area.height / Math.max(1, height), 1.8);
  const tx = area.x + (area.width - width * scale) / 2 - bounds.left * scale;
  const ty = area.y + (area.height - height * scale) / 2 - bounds.top * scale;
  const nodeSvg = (node: LayoutNode): string => {
    const accent = color(node.color);
    const highlights =
      diagram.state.lens === 'trust'
        ? model.boundaries.filter((boundary) => boundary.members.includes(node.id))
        : [];
    const rings = highlights
      .map(
        (boundary, index) =>
          `<rect x="${node.x - 4 - index * 4}" y="${node.y - 4 - index * 4}" width="${node.width + 8 + index * 8}" height="${node.height + 8 + index * 8}" rx="${16 + index * 4}" fill="none" stroke="${color(boundary.color)}" stroke-width="2"/>`
      )
      .join('');
    const type = node.kindLabel;
    const titleY = node.y + (node.expanded ? METRICS.expandedTitleY : METRICS.collapsed.titleY);
    const descriptionY = titleY + node.titleLines.length * 21 + 3;
    return `<g data-element="${xml(node.id)}">${rings}<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="14" fill="${node.expanded ? theme.group : theme.card}" stroke="${node.status === 'proposed' ? accent : theme.border}" stroke-width="1.3"${node.status === 'proposed' ? ' stroke-dasharray="6 4"' : ''}/>
      <g transform="translate(${number(node.x + node.width - METRICS.toggleRight - METRICS.kindIconSize)} ${number(node.y + METRICS.toggleY + (METRICS.toggleSize - METRICS.kindIconSize) / 2)}) scale(${number(METRICS.kindIconSize / 24)})" color="${theme.appearance === 'dark' ? theme.accent : accent}" opacity="0.85"><title>${xml(type)}</title>${kindIcon(node.kind).markup}</g>
      ${lines(node.titleLines, node.x + (node.expanded ? METRICS.expandedContentX : METRICS.collapsed.contentX), titleY, METRICS.titleSize, METRICS.titleLineHeight, theme.text, 600)}
      ${lines(node.descriptionLines, node.x + METRICS.collapsed.contentX, descriptionY, 12, 17, theme.muted)}
      </g>`;
  };
  const edges = diagram.edges
    .map((edge) => {
      if (!edge.points.length) return '';
      const path = edge.points
        .map((point, index) => `${index ? 'L' : 'M'}${number(point.x)},${number(point.y)}`)
        .join(' ');
      return `<path d="${path}" fill="none" stroke="${edge.status === 'proposed' ? theme.proposed : theme.edge}" stroke-width="1.5"${edge.status === 'proposed' ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#arrow)"/>`;
    })
    .join('');
  const edgeLabels = diagram.edges
    .map((edge) => {
      if (!edge.labelLines.length) return '';
      const width = Math.max(...edge.labelLines.map((line) => textWidth(line, 11))) + 14;
      return `<g><rect x="${edge.label.x - width / 2}" y="${edge.label.y - 13}" width="${width}" height="${edge.labelLines.length * 15 + 8}" rx="5" fill="${theme.label}"/><text x="${edge.label.x}" y="${edge.label.y}" text-anchor="middle" font-size="11" fill="${theme.labelText}">${edge.labelLines.map((line, index) => `<tspan x="${edge.label.x}" dy="${index ? 15 : 0}">${xml(line)}</tspan>`).join('')}</text></g>`;
    })
    .join('');
  const legendRows: { title: string; color: string; width: number }[][] = [[]];
  for (let index = 0; index < legends.length; index++) {
    const title = truncateText(legends[index].title, 400, 14);
    const item = { title, color: color(legends[index].color), width: textWidth(title, 14) + 42 };
    let row = legendRows[legendRows.length - 1];
    const rowWidth = (): number => row.reduce((sum, item) => sum + item.width, 0);
    if (rowWidth() + item.width > 1728 && legendRows.length === 1) {
      legendRows.push([]);
      row = legendRows[1];
    }
    if (rowWidth() + item.width <= 1728) {
      row.push(item);
      continue;
    }
    let remaining = legends.length - index;
    let summary = `+${remaining} more boundaries`;
    while (row.length && rowWidth() + textWidth(summary, 14) + 42 > 1728) {
      row.pop();
      remaining++;
      summary = `+${remaining} more boundaries`;
    }
    row.push({ title: summary, color: theme.subtle, width: textWidth(summary, 14) + 42 });
    break;
  }
  const legend = legendRows
    .map((row, rowIndex) => {
      let x = 100;
      return row
        .map((item) => {
          const output = `<circle cx="${x}" cy="${952 + rowIndex * 28}" r="4" fill="${item.color}"/><text x="${x + 12}" y="${958 + rowIndex * 28}" font-size="14" fill="${theme.legendText}">${xml(item.title)}</text>`;
          x += item.width;
          return output;
        })
        .join('');
    })
    .join('');
  const scope = diagram.state.scope
    ? model.elements.find((element) => element.id === diagram.state.scope)
    : undefined;
  const scopeFooter = scope
    ? `FOCUS: ${truncateText(scope.title, 340, 13)} · ${diagram.outside?.length ?? 0} external connections outside view`
    : `${truncateText(model.id, 340, 13)} · Authored architecture`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" role="img" aria-labelledby="title description" data-theme="${theme.id}" data-theme-appearance="${theme.appearance}">
  <title id="title">${xml(options.title ?? model.title)}</title><desc id="description">${xml(options.subtitle ?? model.description)}. ${diagram.state.lens === 'trust' ? 'Colored outlines mark exact authored boundary members, not inferred trust envelopes.' : 'Architecture structure.'}</desc>
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.edge}"/></marker></defs>
  <rect width="1920" height="1080" fill="${theme.canvas}"/>
  <g font-family="Arial, Helvetica, sans-serif"><text x="96" y="58" font-size="12" letter-spacing="3" fill="${theme.eyebrow}">FRACTAL / SYSTEM MODEL</text>
  <g data-export-layer="title">${lines(titleLines, 96, 116, 48, 54, theme.text, 600)}</g>
  <g data-export-layer="subtitle">${lines(subtitleLines, 96, 116 + titleLines.length * 54, 19, 26, theme.subtitle)}</g>
  <g data-export-layer="diagram" transform="translate(${number(tx)} ${number(ty)}) scale(${number(scale)})">${diagram.nodes
    .filter((node) => node.expanded)
    .sort((a, b) => a.depth - b.depth)
    .map(nodeSvg)
    .join('')}${edges}${diagram.nodes
    .filter((node) => !node.expanded)
    .map(nodeSvg)
    .join('')}${edgeLabels}</g>
  <g data-export-layer="legend">${legend}</g><path d="M96 1010H1824" stroke="${theme.divider}"/><text x="96" y="1044" font-size="13" fill="${theme.subtle}">${xml(diagram.state.lens === 'trust' ? 'AUTHORITY & TRUST · EXACT MEMBER OUTLINES' : 'STRUCTURE')} · ${diagram.state.proposed ? 'CURRENT + PROPOSED' : 'CURRENT SYSTEM'}</text><text x="1824" y="1044" text-anchor="end" font-size="13" fill="${theme.subtle}">${xml(scopeFooter)}</text></g></svg>`;
}
