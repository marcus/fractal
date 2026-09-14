import { ARCHITECTURE_NODE_METRICS as NODE_METRICS } from '../core/node-metrics';
import { wrapText } from '../core/projection';
import type { Diagram, LayoutEngineId } from '../core/types';
import type { ComposedProject, Frame } from './types';

/**
 * Deterministic automatic placement. The root sits at the origin; later frames follow in state
 * order to the right (`elk-layered`) or below (`elk-layered-down`). No remembered or manual
 * coordinates: canonical CLI/export geometry stays reproducible. The renderer shares these metrics
 * so a frame drawn on the canvas is the frame that was placed.
 */
export const COMPOSITION_METRICS = {
  /** Corridor between adjacent frames; also the routing escape distance. */
  gap: 72,
  /** Inner padding between a frame edge and its local diagram content. */
  padding: 20,
  /** Horizontal and vertical breathing room around a project title. */
  titleClearance: 16,
  titleLineHeight: NODE_METRICS.titleLineHeight,
  /** A collapsed project is a fixed-size summary card, not a layout. */
  summary: { width: 260, height: 88 }
} as const;

export interface FrameEntry {
  model: string;
  title: string;
  mode: 'open' | 'collapsed';
  diagram: Diagram | null;
  engine: LayoutEngineId;
}

export type PlacedProject = Omit<ComposedProject, 'revision' | 'scene'>;

interface FrameSize {
  frame: Frame;
  titleLines: string[];
  titleHeight: number;
  content: Frame;
}

function sizeFrame(entry: FrameEntry): FrameSize {
  const collapsed = entry.mode === 'collapsed' || entry.diagram === null;
  const width = collapsed
    ? COMPOSITION_METRICS.summary.width
    : entry.diagram!.width + COMPOSITION_METRICS.padding * 2;
  const wrapWidth = Math.max(1, width - COMPOSITION_METRICS.titleClearance * 2);
  const titleLines = wrapText(entry.title, wrapWidth, NODE_METRICS.titleSize);
  const titleHeight =
    titleLines.length * COMPOSITION_METRICS.titleLineHeight +
    COMPOSITION_METRICS.titleClearance * 2;
  if (collapsed) {
    return {
      frame: { x: 0, y: 0, width, height: COMPOSITION_METRICS.summary.height },
      titleLines,
      titleHeight,
      content: { x: 0, y: 0, width: 0, height: 0 }
    };
  }
  const height = titleHeight + entry.diagram!.height + COMPOSITION_METRICS.padding * 2;
  return {
    frame: { x: 0, y: 0, width, height },
    titleLines,
    titleHeight,
    content: {
      x: 0,
      y: 0,
      width: entry.diagram!.width,
      height: entry.diagram!.height
    }
  };
}

export function placeFrames(entries: FrameEntry[]): {
  projects: PlacedProject[];
  width: number;
  height: number;
} {
  const vertical = entries[0]?.engine === 'elk-layered-down';
  const projects: PlacedProject[] = [];
  let cursor = 0;
  for (const entry of entries) {
    const size = sizeFrame(entry);
    const x = vertical ? 0 : cursor;
    const y = vertical ? cursor : 0;
    cursor += (vertical ? size.frame.height : size.frame.width) + COMPOSITION_METRICS.gap;
    projects.push({
      model: entry.model,
      title: entry.title,
      mode: entry.mode,
      frame: { ...size.frame, x, y },
      titleLines: size.titleLines,
      titleHeight: size.titleHeight,
      content: {
        ...size.content,
        x: x + COMPOSITION_METRICS.padding,
        y: y + size.titleHeight + COMPOSITION_METRICS.padding
      },
      diagram: entry.diagram
    });
  }
  const width = projects.reduce(
    (max, project) => Math.max(max, project.frame.x + project.frame.width),
    0
  );
  const height = projects.reduce(
    (max, project) => Math.max(max, project.frame.y + project.frame.height),
    0
  );
  return { projects, width, height };
}
