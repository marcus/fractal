import { truncateText, wrapText } from '../core/projection';
import { getTheme } from '../core/themes';
import { PARTICIPANT_HEADER, selfMessagePath } from './metrics';
import type { SequenceDiagram, SequenceJourney, SequenceRow } from './types';

function xml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function lines(
  values: readonly string[],
  x: number,
  y: number,
  size: number,
  fill: string,
  anchor = 'middle'
): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${fill}">${values
    .map((line, index) => `<tspan x="${x}" dy="${index ? size + 4 : 0}">${xml(line)}</tspan>`)
    .join('')}</text>`;
}

function provenance(row: SequenceRow): string {
  return `data-row-id="${xml(row.id)}" data-message-ids="${xml(row.messageIds.join(','))}" data-participant-ids="${xml(row.participantIds.join(','))}"`;
}

function boundedLines(text: string, width: number, size: number, limit: number): string[] {
  const wrapped = wrapText(text, width, size);
  if (wrapped.length <= limit) return wrapped;
  const visible = wrapped.slice(0, limit);
  visible[limit - 1] = truncateText(`${visible[limit - 1]}…`, width, size);
  return visible;
}

/** Portable 16:9 sequence artwork with no browser-only foreignObject content. */
export function exportSequenceSvg(journey: SequenceJourney, diagram: SequenceDiagram): string {
  if (journey.id !== diagram.journeyId) throw new Error('journey and diagram IDs must match');
  const theme = getTheme(diagram.state.theme);
  const columns = new Map(diagram.columns.map((column) => [column.id, column]));
  const filtered =
    diagram.state.scopePhase !== undefined || diagram.state.visiblePhases !== undefined;
  const included = new Set(diagram.rows.flatMap((row) => row.messageIds)).size;
  const titleLines = boundedLines(journey.title, 1500, 34, 2);
  const subtitleLines = journey.description ? boundedLines(journey.description, 1500, 15, 2) : [];
  const titleBottom = 88 + (titleLines.length - 1) * 38;
  const subtitleY = titleBottom + 38;
  const headerBottom = subtitleLines.length
    ? subtitleY + (subtitleLines.length - 1) * 19
    : titleBottom;
  const contentTop = Math.max(190, headerBottom + 30);
  const contentHeight = 950 - contentTop;
  const scale = Math.min(1, 1780 / diagram.width, contentHeight / diagram.height);
  const translateX = (1920 - diagram.width * scale) / 2;
  const translateY = contentTop + (contentHeight - diagram.height * scale) / 2;
  const columnMarkup = diagram.columns
    .map(
      (
        column
      ) => `<g data-column="${xml(column.id)}" data-members="${xml(column.memberIds.join(','))}" data-elements="${xml(column.elementIds.join(','))}">
    <rect x="${column.x - column.width / 2}" y="${column.y}" width="${column.width}" height="${column.height}" rx="12" fill="${theme.card}" stroke="${column.color}" stroke-width="2"/>
    ${lines(column.titleLines, column.x, column.y + PARTICIPANT_HEADER.titleBaseline, 15, theme.text)}
    <path d="M${column.x} ${column.y + column.height}V${Math.max(column.y + column.height, diagram.height - 70)}" stroke="${theme.divider}" stroke-width="1.2" stroke-dasharray="5 7"/>
  </g>`
    )
    .join('');
  const gapMarkup = diagram.gaps
    .map(
      (
        gap
      ) => `<g data-hidden-lanes="${xml(gap.participantIds.join(','))}" aria-label="${gap.participantIds.length} hidden lanes: ${xml(gap.titles.join(', '))}">
    <title>${xml(gap.titles.join(', '))} (hidden)</title>
    <rect x="${gap.x - gap.width / 2}" y="${gap.y}" width="${gap.width}" height="${gap.height}" rx="4" fill="${theme.canvas}"/>
    <text x="${gap.x}" y="${gap.y + 13}" text-anchor="middle" font-size="11" fill="${theme.subtle}">${gap.participantIds.length}</text>
    <path d="M${gap.x - 7} ${gap.y + 23}h14m-10 -3l-4 3l4 3m6 -6l4 3l-4 3" fill="none" stroke="${theme.subtle}" stroke-width="1"/>
  </g>`
    )
    .join('');
  const rowMarkup = diagram.rows
    .map((row) => {
      const center = row.y + row.height / 2;
      if (row.type === 'phase') {
        const left = row.x;
        const detail = row.descriptionY
          ? lines(
              row.descriptionLines,
              row.titleX + (row.descriptionDx ?? 0),
              row.descriptionY,
              11,
              theme.subtle,
              'start'
            )
          : '';
        return `<g ${provenance(row)} data-row-type="phase" data-phase-depth="${row.depth}" data-collapsed="${row.collapsed === true}">
        ${row.depth > 0 ? `<line x1="${left}" x2="${left + row.width}" y1="${row.y + row.height - 2}" y2="${row.y + row.height - 2}" stroke="${theme.border}" stroke-width="1.2"${row.collapsed ? ' stroke-dasharray="7 5"' : ''}/>` : `<rect x="${left}" y="${row.y}" width="${row.width}" height="${row.height}" rx="10" fill="${theme.group}" stroke="${theme.border}"${row.collapsed ? ' stroke-dasharray="7 5"' : ''}/>`}
        ${lines(row.titleLines, row.titleX + (row.titleDx ?? 0), row.titleY, 15, theme.text, 'start')}
        ${detail}
        <text x="${row.countX}" y="${center + 4}" text-anchor="end" font-size="11" fill="${theme.subtle}">${row.messageIds.length} interaction${row.messageIds.length === 1 ? '' : 's'}${row.hiddenMessageIds.length ? ` · ${row.hiddenMessageIds.length} hidden` : ''}${row.contextOnly ? ' · context' : row.collapsed ? ' · collapsed' : ''}</text>
      </g>`;
      }
      if (row.type === 'hidden') {
        const middle = diagram.width / 2;
        const detail = row.descriptionY
          ? lines(
              row.descriptionLines,
              middle + (row.descriptionDx ?? 0),
              row.descriptionY,
              11,
              theme.subtle
            )
          : '';
        return `<g ${provenance(row)} data-row-type="hidden">
        <rect x="${middle - 340}" y="${row.y}" width="680" height="${row.height}" rx="9" fill="${theme.label}" stroke="${theme.border}" stroke-dasharray="4 4"/>
        ${lines(row.titleLines, middle + (row.titleDx ?? 0), row.titleY, 13, theme.muted)}
        ${detail}
      </g>`;
      }
      const from = columns.get(row.from!)!;
      const to = columns.get(row.to!)!;
      if (row.type === 'internal') {
        const detail = row.descriptionY
          ? lines(
              row.descriptionLines,
              from.x + (row.descriptionDx ?? 0),
              row.descriptionY,
              11,
              theme.subtle
            )
          : '';
        return `<g ${provenance(row)} data-row-type="internal">
        <rect x="${from.x - Math.min(170, from.width / 2)}" y="${row.y}" width="${Math.min(340, from.width)}" height="${row.height}" rx="9" fill="${theme.label}" stroke="${theme.border}"/>
        ${lines(row.titleLines, from.x + (row.titleDx ?? 0), row.titleY, 13, theme.labelText)}
        ${detail}
      </g>`;
      }
      const direction = from.x <= to.x ? 1 : -1;
      const marker = row.kind === 'async' ? 'arrow-open' : 'arrow';
      const dash = row.kind === 'return' ? ' stroke-dasharray="7 5"' : '';
      const labelX = (from.x + to.x) / 2;
      const detail = row.descriptionY
        ? lines(
            row.descriptionLines,
            labelX + (row.descriptionDx ?? 0),
            row.descriptionY,
            11,
            theme.subtle
          )
        : '';
      const arrowY = row.arrowY!;
      const arrowPath =
        from.id === to.id
          ? selfMessagePath(from.x, arrowY)
          : `M${from.x} ${arrowY}H${to.x - direction * 8}`;
      return `<g ${provenance(row)} data-row-type="message" data-kind="${row.kind}">
      <rect x="${labelX - 180}" y="${row.y}" width="360" height="${row.height - 16}" rx="7" fill="${theme.label}"/>
      ${lines(row.titleLines, labelX + (row.titleDx ?? 0), row.titleY, 13, theme.labelText)}
      ${detail}
      <path d="${arrowPath}" fill="none" stroke="${theme.edge}" stroke-width="2"${dash} marker-end="url(#${marker})"/>
    </g>`;
    })
    .join('');
  const source = truncateText(journey.provenance, 1230, 11);
  const metadata = xml(
    JSON.stringify({
      journeyId: journey.id,
      provenance: journey.provenance,
      hiddenLanes: diagram.gaps,
      rows: diagram.rows.map(({ id, type, messageIds, hiddenMessageIds, participantIds }) => ({
        id,
        type,
        messageIds,
        hiddenMessageIds,
        participantIds
      }))
    })
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" role="img" aria-labelledby="sequence-title sequence-description" data-theme="${theme.id}" data-theme-appearance="${theme.appearance}">
  <title id="sequence-title">${xml(journey.title)}</title><desc id="sequence-description">${xml(journey.description)}</desc><metadata>${metadata}</metadata>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${theme.edge}"/></marker>
    <marker id="arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10" fill="none" stroke="${theme.edge}" stroke-width="1.5"/></marker>
  </defs>
  <rect width="1920" height="1080" fill="${theme.canvas}"/>
  <g font-family="Arial, Helvetica, sans-serif" data-export-layer="title">
    <text x="70" y="43" font-size="11" letter-spacing="2.5" fill="${theme.eyebrow}">FRACTAL / SEQUENCE JOURNEY</text>
    ${lines(titleLines, 70, 88, 34, theme.text, 'start')}
    ${lines(subtitleLines, 70, subtitleY, 15, theme.subtitle, 'start')}
  </g>
  <g font-family="Arial, Helvetica, sans-serif" transform="translate(${translateX} ${translateY}) scale(${scale})">${columnMarkup}${gapMarkup}${rowMarkup}</g>
  <g font-family="Arial, Helvetica, sans-serif" data-export-layer="footer">
    <path d="M70 992H1850" stroke="${theme.divider}"/>
    <text x="70" y="1027" font-size="12" font-weight="600" letter-spacing="1" fill="${theme.eyebrow}">${xml(journey.status.toUpperCase())} · ${filtered ? `${included} OF ${diagram.totalMessages} INTERACTIONS` : `${diagram.totalMessages} INTERACTIONS`}</text>
    <text x="620" y="1027" font-size="11" fill="${theme.subtle}">SOURCE · ${xml(source)}</text>
  </g>
  </svg>`;
}
