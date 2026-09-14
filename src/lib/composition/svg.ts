import type { ComposedDiagram, ComposedProject, Frame } from './types';
import type { LayoutEdge, LayoutNode, Model } from '../core/types';
import { getTheme } from '../core/themes';
import { ARCHITECTURE_NODE_METRICS as METRICS } from '../core/node-metrics';
import { kindIcon } from '../core/kind-icons';
import { textWidth, truncateText, wrapText } from '../core/projection';
import { COMPOSITION_METRICS } from './place';
import { escapeXml, formatSvgNumber } from '../core/svg';

const number = formatSvgNumber;
const xml = escapeXml;

/** Namespaced the same way the studio slugs project IDs for DOM ids. */
const slug = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-');
const namespaced = (model: string, local: string): string => `cmp-${slug(model)}-${local}`;

const STUB_WIDTH = 236;
const STUB_BODY = 204;
const PORT_CAPTION = 'outside scope';

function color(value: string): string {
  return /^#[\da-f]{3,8}$/i.test(value) ? value : '#557b70';
}

function boundedLines(text: string, width: number, size: number, limit: number): string[] {
  const wrapped = wrapText(text, width, size);
  if (wrapped.length <= limit) return wrapped;
  const visible = wrapped.slice(0, limit);
  visible[limit - 1] = truncateText(visible[limit - 1] + '…', width, size);
  return visible;
}

const textLines = (
  values: string[],
  x: number,
  y: number,
  size: number,
  leading: number,
  fill: string,
  weight = 400,
  anchor?: string
): string =>
  `<text x="${number(x)}" y="${number(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}>${values.map((line, index) => `<tspan x="${number(x)}" dy="${index ? leading : 0}">${xml(line)}</tspan>`).join('')}</text>`;

function labelBadge(
  lines: string[],
  cx: number,
  cy: number,
  theme: { label: string; labelText: string }
): string {
  if (!lines.length) return '';
  const width = Math.max(...lines.map((line) => textWidth(line, 11))) + 14;
  return `<g><rect x="${number(cx - width / 2)}" y="${number(cy - 13)}" width="${number(width)}" height="${lines.length * 15 + 8}" rx="5" fill="${theme.label}"/><text x="${number(cx)}" y="${number(cy)}" text-anchor="middle" font-size="11" fill="${theme.labelText}">${lines.map((line, index) => `<tspan x="${number(cx)}" dy="${index ? 15 : 0}">${xml(line)}</tspan>`).join('')}</text></g>`;
}

function nodeSvg(
  model: Model,
  project: ComposedProject,
  node: LayoutNode,
  lens: 'structure' | 'trust',
  theme: ReturnType<typeof getTheme>
): string {
  const accent = color(node.color);
  const highlights =
    lens === 'trust'
      ? model.boundaries.filter((boundary) => boundary.members.includes(node.id))
      : [];
  const rings = highlights
    .map(
      (boundary, index) =>
        `<rect x="${node.x - 4 - index * 4}" y="${node.y - 4 - index * 4}" width="${node.width + 8 + index * 8}" height="${node.height + 8 + index * 8}" rx="${16 + index * 4}" fill="none" stroke="${color(boundary.color)}" stroke-width="2"/>`
    )
    .join('');
  const titleY = node.y + (node.expanded ? METRICS.expandedTitleY : METRICS.collapsed.titleY);
  const descriptionY = titleY + node.titleLines.length * 21 + 3;
  return `<g data-project="${xml(project.model)}" data-node-id="${xml(project.model)}:${xml(node.id)}">${rings}<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="14" fill="${node.expanded ? theme.group : theme.card}" stroke="${node.status === 'proposed' ? accent : theme.border}" stroke-width="1.3"${node.status === 'proposed' ? ' stroke-dasharray="6 5"' : ''}/>
      <g transform="translate(${number(node.x + node.width - METRICS.toggleRight - METRICS.kindIconSize)} ${number(node.y + METRICS.toggleY + (METRICS.toggleSize - METRICS.kindIconSize) / 2)}) scale(${number(METRICS.kindIconSize / 24)})" color="${theme.appearance === 'dark' ? theme.accent : accent}" opacity="0.85"><title>${xml(node.kindLabel)}</title>${kindIcon(node.kind).markup}</g>
      ${textLines(node.titleLines, node.x + (node.expanded ? METRICS.expandedContentX : METRICS.collapsed.contentX), titleY, METRICS.titleSize, METRICS.titleLineHeight, theme.text, 600)}
      ${textLines(node.descriptionLines, node.x + METRICS.collapsed.contentX, descriptionY, 12, 17, theme.muted)}
      </g>`;
}

function edgeSvg(edge: LayoutEdge, theme: ReturnType<typeof getTheme>): string {
  if (!edge.points.length) return '';
  const path = edge.points
    .map((point, index) => `${index ? 'L' : 'M'}${number(point.x)},${number(point.y)}`)
    .join(' ');
  return `<path d="${path}" fill="none" stroke="${edge.status === 'proposed' ? theme.proposed : theme.edge}" stroke-width="1.5"${edge.status === 'proposed' ? ' stroke-dasharray="6 5"' : ''}/>`;
}

/** Stub origin mirrors the canvas: below the anchor node, else below-right of the owner frame. */
export function stubOrigin(
  composed: ComposedDiagram,
  stub: ComposedDiagram['stubs'][number]
): { x: number; y: number } {
  const owner = composed.projects.find((project) => project.model === stub.anchor.model);
  if (stub.anchor.element && owner?.diagram) {
    const node = owner.diagram.nodes.find((candidate) => candidate.id === stub.anchor.element);
    if (node)
      return { x: owner.content.x + node.x, y: owner.content.y + node.y + node.height + 12 };
  }
  const frame = owner?.frame ?? composed.projects[0].frame;
  return { x: frame.x + frame.width - STUB_WIDTH, y: frame.y + frame.height + 16 };
}

function stubCard(
  composed: ComposedDiagram,
  stub: ComposedDiagram['stubs'][number],
  theme: ReturnType<typeof getTheme>
): string {
  const position = stubOrigin(composed, stub);
  const failed = stub.state !== 'not_loaded';
  const diagnostic = composed.diagnostics.find(
    (entry) =>
      (stub.linkId !== undefined && entry.linkId === stub.linkId) ||
      (stub.connectionId !== undefined && entry.connectionId === stub.connectionId)
  );
  const stateLine =
    stub.state === 'unavailable'
      ? 'Diagram unavailable'
      : stub.state === 'invalid'
        ? 'Diagram invalid'
        : 'Diagram not opened';
  const detail =
    stub.state === 'not_loaded'
      ? stub.target.model
      : (diagnostic?.message ?? `${stub.title} could not be resolved.`);
  const guidance =
    failed && diagnostic
      ? (
          {
            register: 'Register the project in the catalog, then retry.',
            retry: 'Retry once the source stops changing.',
            repair: 'Repair the authored reference.',
            upgrade: 'Upgrade the reader or the model version.',
            reload: 'Reload the changed source.',
            reduce: 'Reduce the composition to fit its budget.'
          } as const
        )[diagnostic.recovery]
      : null;
  const detailLines = wrapText(detail, STUB_BODY, 10);
  const guidanceLines = guidance ? wrapText(guidance, STUB_BODY, 10) : [];
  const firstDetail = 66;
  const height = firstDetail + detailLines.length * 14 + guidanceLines.length * 14 + 10;
  const lines = [
    `<text x="16" y="26" font-size="13" font-weight="600" fill="${theme.text}">${xml(stub.title)}</text>`,
    `<text x="16" y="46" font-size="11" fill="${theme.muted}">${xml(stateLine)}</text>`,
    ...detailLines.map(
      (line, index) =>
        `<text x="16" y="${firstDetail + index * 14}" font-size="10" fill="${theme.muted}">${xml(line)}</text>`
    ),
    ...guidanceLines.map(
      (line, index) =>
        `<text x="16" y="${firstDetail + detailLines.length * 14 + index * 14}" font-size="10" font-style="italic" fill="${theme.muted}">${xml(line)}</text>`
    )
  ].join('');
  const label =
    stub.state === 'not_loaded'
      ? `${stub.title}: diagram not opened. Target ${stub.target.model}.`
      : `${stub.title}: ${stub.state === 'invalid' ? 'invalid' : 'unavailable'}. ${detail}`;
  return `<g data-stub-owner="${xml(stub.owner)}" data-stub-target="${xml(stub.target.model)}" data-stub-state="${stub.state}" transform="translate(${number(position.x)} ${number(position.y)})" role="group" aria-label="${xml(label)}"><rect width="${STUB_WIDTH}" height="${height}" rx="12" fill="${theme.card}" stroke="${theme.border}"/>${lines}</g>`;
}

function portSvg(
  project: ComposedProject,
  port: ComposedProject['ports'][number],
  theme: ReturnType<typeof getTheme>
): string {
  const bodyWidth = Math.max(...port.labelLines.map((line) => textWidth(line, 11)), 0) + 24;
  const captionWidth = textWidth(PORT_CAPTION, 9) + 24;
  const width = Math.max(bodyWidth, captionWidth);
  const height = port.labelLines.length * 15 + 30;
  const x = port.point.x - width / 2;
  const y = port.point.y - height / 2;
  return `<g data-port-model="${xml(port.model)}" data-port-element="${xml(port.reveal.element)}" data-port-side="${port.side}" transform="translate(${number(x)} ${number(y)})" role="group" aria-label="${xml(`Outside scope: ${port.reveal.element}. Reveal in ${port.model}.`)}"><rect width="${number(width)}" height="${height}" rx="10" fill="${theme.card}" stroke="${theme.subtle}" stroke-width="1.2"/>${port.labelLines.map((line, index) => `<text x="${number(width / 2)}" y="${22 + index * 15}" text-anchor="middle" font-size="11" fill="${theme.text}">${xml(line)}</text>`).join('')}<text x="${number(width / 2)}" y="${22 + port.labelLines.length * 15}" text-anchor="middle" font-size="9" fill="${theme.muted}">${xml(PORT_CAPTION)}</text></g>`;
}

function frameSvg(
  project: ComposedProject,
  theme: ReturnType<typeof getTheme>
): { frame: string; titleId: string } {
  const titleId = namespaced(project.model, 'title');
  const titleX =
    project.frame.x + COMPOSITION_METRICS.padding + COMPOSITION_METRICS.titleClearance + 18;
  const firstLineY = project.frame.y + COMPOSITION_METRICS.titleClearance + METRICS.titleSize;
  const titles = project.titleLines
    .map(
      (line, index) =>
        `<text${index === 0 ? ` id="${titleId}"` : ''} x="${number(titleX)}" y="${number(firstLineY + index * COMPOSITION_METRICS.titleLineHeight)}" font-size="14" font-weight="600" fill="${theme.text}">${xml(line)}</text>`
    )
    .join('');
  const summary =
    project.mode === 'collapsed'
      ? `<text x="${number(titleX)}" y="${number(project.frame.y + project.titleHeight + 30)}" font-size="12" fill="${theme.muted}">Collapsed summary</text>`
      : '';
  return {
    titleId,
    frame: `<g data-project-frame="${xml(project.model)}" data-project-mode="${project.mode}" aria-labelledby="${titleId}"><rect x="${number(project.frame.x)}" y="${number(project.frame.y)}" width="${number(project.frame.width)}" height="${number(project.frame.height)}" rx="18" fill="${theme.surface}" fill-opacity="0.5" stroke="${theme.border}" stroke-width="1.2"/><line x1="${number(project.frame.x)}" y1="${number(project.frame.y + project.titleHeight)}" x2="${number(project.frame.x + project.frame.width)}" y2="${number(project.frame.y + project.titleHeight)}" stroke="${theme.divider}" stroke-width="1"/>${titles}${summary}</g>`
  };
}

/**
 * Render a composed diagram as portable SVG. Every project frame, local diagram (translated
 * by its frame transform), perimeter port, reference stub and bridge draws from composed
 * coordinates, independent of viewport culling: offscreen content is always included and UI
 * chrome is excluded. Ids are namespaced per project; the two arrow markers are defined
 * once at the root. Output is deterministic for the same input. Page framing matches
 * single-model `exportSvg`: themed full-document background, title, subtitle, and footer.
 */
export function exportCompositionSvg(
  composed: ComposedDiagram,
  models: Record<string, Model>,
  options: { title?: string; subtitle?: string } = {}
): string {
  const theme = getTheme(composed.state.theme);
  const rootTitle = models[composed.state.root]?.title ?? composed.state.root;
  const title = options.title ?? rootTitle;
  const subtitle =
    options.subtitle ??
    composed.projects
      .map((project) => {
        const name = models[project.model]?.title ?? project.title;
        return project.scene ? `${name} / ${project.scene}` : name;
      })
      .join(' · ');
  const identities = composed.projects.map((project) => project.model).join(' · ');
  const anyProposed = composed.state.projects.some((project) => project.view.proposed);
  const anyTrust = composed.state.projects.some((project) => project.view.lens === 'trust');

  let minX = 0;
  let minY = 0;
  let maxX = composed.width;
  let maxY = composed.height;
  const includePoint = (x: number, y: number, extraX = 0, extraY = 0) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + extraX);
    maxY = Math.max(maxY, y + extraY);
  };
  for (const stub of composed.stubs) {
    const origin = stubOrigin(composed, stub);
    includePoint(origin.x, origin.y, STUB_WIDTH, 120);
  }
  for (const bridge of composed.bridges) {
    includePoint(bridge.label.x, bridge.label.y);
    for (const point of bridge.points) includePoint(point.x, point.y);
  }
  const bounds: Frame = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  const marginX = 96;
  const pad = 48;
  const viewWidth = Math.max(bounds.width + marginX * 2, 960);
  const copyWidth = viewWidth - marginX * 2;
  const titleLines = boundedLines(title, copyWidth, 48, 2);
  const subtitleLines = boundedLines(subtitle, copyWidth, 19, 3);
  const headerBottom = 92 + titleLines.length * 54 + subtitleLines.length * 26 + 38;
  const ox = marginX - bounds.x;
  const oy = headerBottom + pad - bounds.y;
  const footerY = headerBottom + pad + bounds.height + pad;
  const viewHeight = footerY + 70;
  const footerLeft = anyTrust ? 'AUTHORITY & TRUST · EXACT MEMBER OUTLINES' : 'STRUCTURE';
  const footerStatus = anyProposed ? 'CURRENT + PROPOSED' : 'CURRENT SYSTEM';
  const footerRight = truncateText(
    identities.length
      ? `${identities} · Linked architecture`
      : `${composed.state.root} · Linked architecture`,
    copyWidth / 2,
    13
  );

  // One origin shift wraps every composed-coordinate layer; local diagram content nests
  // its frame transform inside it, so the same numbers the canvas draws are exported.
  const layers: string[] = [];
  for (const project of composed.projects) {
    const { frame } = frameSvg(project, theme);
    layers.push(frame);
    const model = models[project.model];
    if (project.diagram && model) {
      const lens =
        composed.state.projects.find((entry) => entry.model === project.model)?.view.lens ??
        'structure';
      const nodes = project.diagram.nodes;
      const groups = nodes
        .filter((node) => node.expanded)
        .sort((a, b) => a.depth - b.depth)
        .map((node) => nodeSvg(model, project, node, lens, theme))
        .join('');
      const cards = nodes
        .filter((node) => !node.expanded)
        .map((node) => nodeSvg(model, project, node, lens, theme))
        .join('');
      const edges = project.diagram.edges.map((edge) => edgeSvg(edge, theme)).join('');
      const edgeLabels = project.diagram.edges
        .map((edge) =>
          edge.labelLines.length
            ? labelBadge(edge.labelLines, edge.label.x, edge.label.y, theme)
            : ''
        )
        .join('');
      layers.push(
        `<g data-project-content="${xml(project.model)}" transform="translate(${number(project.content.x)} ${number(project.content.y)})">${groups}${edges}${cards}${edgeLabels}</g>`
      );
    }
    for (const port of project.ports) layers.push(portSvg(project, port, theme));
  }

  const bridges = composed.bridges
    .map((bridge) => {
      const path = bridge.points
        .map((point, index) => `${index ? 'L' : 'M'}${number(point.x)},${number(point.y)}`)
        .join(' ');
      const proposed = bridge.status === 'proposed';
      return `<g data-connection-owner="${xml(bridge.owner)}" data-connection-id="${xml(bridge.id)}" role="img" aria-label="${xml(`${bridge.title}: ${bridge.source.model}/${bridge.source.element} to ${bridge.target.model}/${bridge.target.element}`)}"><path d="${path}" fill="none" stroke="${proposed ? theme.proposed : theme.edge}" stroke-width="1.5"${proposed ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#cmp-arrow${proposed ? '-proposed' : ''})"/>${bridge.labelLines.length ? labelBadge(bridge.labelLines, bridge.label.x, bridge.label.y, theme) : ''}</g>`;
    })
    .join('');

  const stubs = composed.stubs.map((stub) => stubCard(composed, stub, theme)).join('');
  const artwork = `<g data-export-layer="diagram" transform="translate(${number(ox)} ${number(oy)})">${layers.join('')}${bridges}${stubs}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(viewWidth)}" height="${number(viewHeight)}" viewBox="0 0 ${number(viewWidth)} ${number(viewHeight)}" role="img" aria-labelledby="cmp-title cmp-description" data-theme="${theme.id}" data-theme-appearance="${theme.appearance}">
  <title id="cmp-title">${xml(title)}</title><desc id="cmp-description">${xml(subtitle)}</desc>
  <defs><marker id="cmp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${theme.edge}" stroke-width="1.5"/></marker><marker id="cmp-arrow-proposed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${theme.proposed}" stroke-width="1.5"/></marker></defs>
  <rect width="${number(viewWidth)}" height="${number(viewHeight)}" fill="${theme.canvas}"/>
  <g font-family="Arial, Helvetica, sans-serif"><text x="${marginX}" y="58" font-size="12" letter-spacing="3" fill="${theme.eyebrow}">FRACTAL / LINKED COMPOSITION</text>
  <g data-export-layer="title">${textLines(titleLines, marginX, 116, 48, 54, theme.text, 600)}</g>
  <g data-export-layer="subtitle">${textLines(subtitleLines, marginX, 116 + titleLines.length * 54, 19, 26, theme.subtitle)}</g>
  ${artwork}
  <g data-export-layer="footer"><path d="M${marginX} ${number(footerY)}H${number(viewWidth - marginX)}" stroke="${theme.divider}"/><text x="${marginX}" y="${number(footerY + 34)}" font-size="13" fill="${theme.subtle}">${xml(footerLeft)} · ${footerStatus}</text><text x="${number(viewWidth - marginX)}" y="${number(footerY + 34)}" text-anchor="end" font-size="13" fill="${theme.subtle}">${xml(footerRight)}</text></g></g></svg>`;
}
