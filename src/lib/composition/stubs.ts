import { wrapText } from '../core/projection';
import type { Point } from '../core/types';
import type { ComposedDiagram, CompositionDiagnostic, ReferenceStub } from './types';

export const REFERENCE_STUB_WIDTH = 236;
export const REFERENCE_STUB_BODY_WIDTH = REFERENCE_STUB_WIDTH - 32;
export const REFERENCE_STUB_GAP = 12;

const FIRST_DETAIL_Y = 66;
const DETAIL_LINE_HEIGHT = 14;
const BOTTOM_PADDING = 10;

const RECOVERY_GUIDANCE: Record<CompositionDiagnostic['recovery'], string> = {
  register: 'Register the project in the catalog, then retry.',
  retry: 'Retry once the source stops changing.',
  repair: 'Repair the authored reference.',
  upgrade: 'Upgrade the reader or the model version.',
  reload: 'Reload the changed source.',
  reduce: 'Reduce the composition to fit its budget.'
};

export interface ReferenceStubGeometry {
  position: Point;
  width: number;
  height: number;
  detailLines: string[];
  guidanceLines: string[];
}

function diagnosticFor(
  diagnostics: readonly CompositionDiagnostic[],
  stub: ReferenceStub
): CompositionDiagnostic | undefined {
  return diagnostics.find(
    (diagnostic) =>
      (stub.linkId !== undefined && diagnostic.linkId === stub.linkId) ||
      (stub.connectionId !== undefined && diagnostic.connectionId === stub.connectionId)
  );
}

export function referenceStubDetail(
  diagnostics: readonly CompositionDiagnostic[],
  stub: ReferenceStub
): string {
  if (stub.state === 'not_loaded') return stub.target.model;
  return diagnosticFor(diagnostics, stub)?.message ?? `${stub.title} could not be resolved.`;
}

export function referenceStubGuidance(
  diagnostics: readonly CompositionDiagnostic[],
  stub: ReferenceStub
): string | null {
  if (stub.state === 'not_loaded') return null;
  const recovery = diagnosticFor(diagnostics, stub)?.recovery;
  return recovery ? RECOVERY_GUIDANCE[recovery] : null;
}

function anchorKey(stub: ReferenceStub): string {
  return `${stub.anchor.model}\n${stub.anchor.element ?? ''}`;
}

/** Base origin below the local anchor, or below-right of the owner frame for a root link. */
function baseOrigin(composed: ComposedDiagram, stub: ReferenceStub): Point {
  const owner = composed.projects.find((project) => project.model === stub.anchor.model);
  if (stub.anchor.element && owner?.diagram) {
    const node = owner.diagram.nodes.find((candidate) => candidate.id === stub.anchor.element);
    if (node)
      return { x: owner.content.x + node.x, y: owner.content.y + node.y + node.height + 12 };
  }
  const frame = owner?.frame ?? composed.projects[0]?.frame;
  return frame
    ? { x: frame.x + frame.width - REFERENCE_STUB_WIDTH, y: frame.y + frame.height + 16 }
    : { x: 0, y: 0 };
}

function measuredStub(
  diagnostics: readonly CompositionDiagnostic[],
  stub: ReferenceStub
): Omit<ReferenceStubGeometry, 'position'> {
  const detailLines = wrapText(
    referenceStubDetail(diagnostics, stub),
    REFERENCE_STUB_BODY_WIDTH,
    10
  );
  const guidance = referenceStubGuidance(diagnostics, stub);
  const guidanceLines = guidance ? wrapText(guidance, REFERENCE_STUB_BODY_WIDTH, 10) : [];
  return {
    width: REFERENCE_STUB_WIDTH,
    height:
      FIRST_DETAIL_Y +
      detailLines.length * DETAIL_LINE_HEIGHT +
      guidanceLines.length * DETAIL_LINE_HEIGHT +
      BOTTOM_PADDING,
    detailLines,
    guidanceLines
  };
}

/** Cards sharing one authored anchor form a deterministic vertical stack. */
export function referenceStubGeometries(
  composed: ComposedDiagram
): Map<ReferenceStub, ReferenceStubGeometry> {
  const result = new Map<ReferenceStub, ReferenceStubGeometry>();
  const nextY = new Map<string, number>();
  for (const stub of composed.stubs) {
    const base = baseOrigin(composed, stub);
    const measured = measuredStub(composed.diagnostics, stub);
    const key = anchorKey(stub);
    const y = nextY.get(key) ?? base.y;
    result.set(stub, { ...measured, position: { x: base.x, y } });
    nextY.set(key, y + measured.height + REFERENCE_STUB_GAP);
  }
  return result;
}
