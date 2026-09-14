import { EDGE_LABEL_WIDTH } from '../core/measure';
import { textWidth, truncateText, wrapText } from '../core/projection';
import type { Point } from '../core/types';
import type { PortSide } from './types';

export const COMPOSITION_PORT_CAPTION = 'outside scope';
export const COMPOSITION_PORT_LABEL_SIZE = 10;
export const COMPOSITION_PORT_LABEL_LINE_HEIGHT = 11;
export const COMPOSITION_PORT_CAPTION_SIZE = 8;
export const COMPOSITION_PORT_PADDING_X = 10;
export const COMPOSITION_PORT_PADDING_Y = 7;
export const COMPOSITION_PORT_CAPTION_GAP = 3;
export const COMPOSITION_PORT_MIN_WIDTH = 78;
export const COMPOSITION_PORT_MAX_LINES = 3;
export const COMPOSITION_PORT_GAP = 8;

export interface CompositionPortSize {
  width: number;
  height: number;
}

export interface CompositionPortGeometry extends CompositionPortSize {
  position: Point;
  labelY: number;
  captionY: number;
}

/** Bound presentation geometry while the full title remains in the composed port contract. */
export function compositionPortLabelLines(title: string): string[] {
  const wrapped = wrapText(title, EDGE_LABEL_WIDTH, COMPOSITION_PORT_LABEL_SIZE);
  if (wrapped.length <= COMPOSITION_PORT_MAX_LINES) return wrapped;
  const visible = wrapped.slice(0, COMPOSITION_PORT_MAX_LINES);
  visible[COMPOSITION_PORT_MAX_LINES - 1] = truncateText(
    visible[COMPOSITION_PORT_MAX_LINES - 1] + '…',
    EDGE_LABEL_WIDTH,
    COMPOSITION_PORT_LABEL_SIZE
  );
  return visible;
}

/** One measured port card shared by layout, the live canvas and SVG/PNG export. */
export function compositionPortSize(labelLines: readonly string[]): CompositionPortSize {
  const labelWidth = Math.max(
    0,
    ...labelLines.map((line) => textWidth(line, COMPOSITION_PORT_LABEL_SIZE))
  );
  const captionWidth = textWidth(COMPOSITION_PORT_CAPTION, COMPOSITION_PORT_CAPTION_SIZE);
  return {
    width: Math.max(
      COMPOSITION_PORT_MIN_WIDTH,
      Math.max(labelWidth, captionWidth) + COMPOSITION_PORT_PADDING_X * 2
    ),
    height:
      COMPOSITION_PORT_PADDING_Y * 2 +
      Math.max(1, labelLines.length) * COMPOSITION_PORT_LABEL_LINE_HEIGHT +
      COMPOSITION_PORT_CAPTION_GAP +
      COMPOSITION_PORT_CAPTION_SIZE
  };
}

export function compositionPortGeometry(
  side: PortSide,
  point: Point,
  labelLines: readonly string[]
): CompositionPortGeometry {
  const size = compositionPortSize(labelLines);
  const position =
    side === 'right'
      ? { x: point.x - size.width, y: point.y - size.height / 2 }
      : side === 'left'
        ? { x: point.x, y: point.y - size.height / 2 }
        : side === 'top'
          ? { x: point.x - size.width / 2, y: point.y }
          : { x: point.x - size.width / 2, y: point.y - size.height };
  const labelBlockHeight = Math.max(1, labelLines.length) * COMPOSITION_PORT_LABEL_LINE_HEIGHT;
  return {
    ...size,
    position,
    labelY: COMPOSITION_PORT_PADDING_Y + COMPOSITION_PORT_LABEL_SIZE,
    captionY:
      COMPOSITION_PORT_PADDING_Y +
      labelBlockHeight +
      COMPOSITION_PORT_CAPTION_GAP +
      COMPOSITION_PORT_CAPTION_SIZE
  };
}
