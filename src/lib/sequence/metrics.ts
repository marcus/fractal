/** Shared participant-header geometry for layout, live canvas, and portable export. */
export const PARTICIPANT_HEADER = {
  titleBaseline: 27,
  lineHeight: 19,
  heightBase: 25
} as const;

export function participantHeaderHeight(titleLineCount: number): number {
  return (
    PARTICIPANT_HEADER.heightBase + Math.max(1, titleLineCount) * PARTICIPANT_HEADER.lineHeight
  );
}

export const SELF_MESSAGE_LOOP_HEIGHT = 20;

/** One shared, gently rounded self-message path for the live canvas and SVG export. */
export function selfMessagePath(x: number, arrowY: number): string {
  return `M ${x} ${arrowY - SELF_MESSAGE_LOOP_HEIGHT} H ${x + 48} Q ${x + 54} ${arrowY - SELF_MESSAGE_LOOP_HEIGHT} ${x + 54} ${arrowY - SELF_MESSAGE_LOOP_HEIGHT + 6} V ${arrowY - 6} Q ${x + 54} ${arrowY} ${x + 48} ${arrowY} H ${x + 8}`;
}
