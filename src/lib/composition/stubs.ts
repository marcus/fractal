import { wrapText } from '../core/projection';
import type { Point } from '../core/types';
import { COMPOSITION_METRICS, type PlacedProject } from './place';
import { compositionPortSize } from './ports';
import type { ComposedDiagram, CompositionDiagnostic, ReferenceStub } from './types';

export const REFERENCE_STUB_WIDTH = 236;
export const REFERENCE_STUB_BODY_WIDTH = REFERENCE_STUB_WIDTH - 32;
export const REFERENCE_STUB_GAP = 12;
export const REFERENCE_STUB_LANE_GAP = 16;
export const REFERENCE_STUB_LANE_PADDING = COMPOSITION_METRICS.padding;

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

function stackHeight(
  diagnostics: readonly CompositionDiagnostic[],
  stubs: readonly ReferenceStub[]
): number {
  return stubs.reduce(
    (height, stub, index) =>
      height + measuredStub(diagnostics, stub).height + (index === 0 ? 0 : REFERENCE_STUB_GAP),
    0
  );
}

/**
 * Reserve an owner-local footer lane before bridges and ports are routed. Cards remain inside
 * their project frame without competing with the independently laid-out model content.
 */
export function reserveReferenceStubLanes(
  projects: PlacedProject[],
  stubs: readonly ReferenceStub[],
  diagnostics: readonly CompositionDiagnostic[],
  vertical: boolean,
  adjustments: {
    bottomPaddingByOwner?: ReadonlyMap<string, number>;
    bodyHeightExtraByOwner?: ReadonlyMap<string, number>;
    minWidthByOwner?: ReadonlyMap<string, number>;
  } = {}
): void {
  const byOwner = new Map<string, ReferenceStub[]>();
  for (const stub of stubs) {
    const group = byOwner.get(stub.owner);
    if (group) group.push(stub);
    else byOwner.set(stub.owner, [stub]);
  }

  let offsetX = 0;
  let offsetY = 0;
  for (const project of projects) {
    if (!vertical && offsetX) {
      project.frame.x += offsetX;
      project.content.x += offsetX;
    }
    if (vertical && offsetY) {
      project.frame.y += offsetY;
      project.content.y += offsetY;
    }
    const owned = byOwner.get(project.model);
    const bodyExtra = adjustments.bodyHeightExtraByOwner?.get(project.model) ?? 0;
    const bottomPadding = Math.max(
      REFERENCE_STUB_LANE_PADDING,
      adjustments.bottomPaddingByOwner?.get(project.model) ?? 0
    );
    const stubExtra = owned?.length
      ? REFERENCE_STUB_LANE_GAP + stackHeight(diagnostics, owned) + bottomPadding
      : 0;
    const extra = bodyExtra + stubExtra;
    const widthExtra = Math.max(
      0,
      Math.max(
        owned?.length ? REFERENCE_STUB_WIDTH + COMPOSITION_METRICS.padding * 2 : 0,
        adjustments.minWidthByOwner?.get(project.model) ?? 0
      ) - project.frame.width
    );
    project.frame.width += widthExtra;
    project.frame.height += extra;
    if (vertical) offsetY += extra;
    else offsetX += widthExtra;
  }
}

function bottomPadding(project: ComposedDiagram['projects'][number]): number {
  return Math.max(
    REFERENCE_STUB_LANE_PADDING,
    ...project.ports
      .filter((port) => port.side === 'bottom')
      .map((port) => compositionPortSize(port.labelLines).height + 8)
  );
}

/** Bottom edge of the laid-out model body, before an optional reference-card footer lane. */
export function referenceStubLaneBodyBottom(project: PlacedProject): number {
  if (project.diagram)
    return project.content.y + project.diagram.height + COMPOSITION_METRICS.padding;
  const baseHeight = Math.max(
    COMPOSITION_METRICS.summary.height,
    project.titleHeight + COMPOSITION_METRICS.summaryBodyHeight
  );
  return project.frame.y + baseHeight;
}

function laneX(composed: ComposedDiagram, ownerModel: string, first: ReferenceStub): number {
  const owner = composed.projects.find((project) => project.model === ownerModel);
  if (!owner) return 0;
  let desired = owner.frame.x + COMPOSITION_METRICS.padding;
  if (first.anchor.element && owner.diagram) {
    const node = owner.diagram.nodes.find((candidate) => candidate.id === first.anchor.element);
    if (node) desired = owner.content.x + node.x;
  }
  const min = owner.frame.x + COMPOSITION_METRICS.padding;
  const max =
    owner.frame.x + owner.frame.width - COMPOSITION_METRICS.padding - REFERENCE_STUB_WIDTH;
  return Math.max(min, Math.min(Math.max(min, max), desired));
}

/** Cards owned by one project form a deterministic stack in its reserved footer lane. */
export function referenceStubGeometries(
  composed: ComposedDiagram
): Map<ReferenceStub, ReferenceStubGeometry> {
  const result = new Map<ReferenceStub, ReferenceStubGeometry>();
  const nextY = new Map<string, number>();
  const xByOwner = new Map<string, number>();
  const byOwner = new Map<string, ReferenceStub[]>();
  for (const stub of composed.stubs) {
    const group = byOwner.get(stub.owner);
    if (group) group.push(stub);
    else byOwner.set(stub.owner, [stub]);
  }
  for (const stub of composed.stubs) {
    const owner = composed.projects.find((project) => project.model === stub.owner);
    const measured = measuredStub(composed.diagnostics, stub);
    const x = xByOwner.get(stub.owner) ?? laneX(composed, stub.owner, stub);
    const y =
      nextY.get(stub.owner) ??
      (owner
        ? owner.frame.y +
          owner.frame.height -
          bottomPadding(owner) -
          stackHeight(composed.diagnostics, byOwner.get(stub.owner) ?? [])
        : 0);
    result.set(stub, { ...measured, position: { x, y } });
    xByOwner.set(stub.owner, x);
    nextY.set(stub.owner, y + measured.height + REFERENCE_STUB_GAP);
  }
  return result;
}
