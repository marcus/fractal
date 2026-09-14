import { layout } from '../core/layout';
import { EDGE_LABEL_SIZE, EDGE_LABEL_WIDTH } from '../core/measure';
import { wrapText } from '../core/projection';
import type { Diagram, Point } from '../core/types';
import { parseCompositionState } from './parse';
import { placeFrames } from './place';
import { COMPOSITION_PORT_GAP, compositionPortLabelLines, compositionPortSize } from './ports';
import { routeAxis, routeBridge } from './route';
import {
  REFERENCE_STUB_LANE_GAP,
  referenceStubGeometries,
  referenceStubLaneBodyBottom,
  reserveReferenceStubLanes
} from './stubs';
import type { RouteEndpoint } from './route';
import type { ProjectSnapshot, ResolutionOutcome, SnapshotResolver } from './snapshot';
import type {
  BridgeRepresentative,
  ComposedBridge,
  ComposedDiagram,
  ComposedPort,
  ComposedProject,
  CompositionDiagnostic,
  CompositionState,
  ElementReference,
  Frame,
  HiddenClaim,
  PortSide,
  ProjectConnection,
  ReferenceStub
} from './types';

type ProjectState = CompositionState['projects'][number];
type Failure = Extract<ResolutionOutcome, { status: 'unavailable' | 'invalid' }>;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Resolve each model once, at most two in flight; the returned map follows the request order. */
async function resolveAll(
  resolver: SnapshotResolver,
  models: string[]
): Promise<Map<string, ResolutionOutcome>> {
  const outcomes = new Map<string, ResolutionOutcome>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < models.length) {
      const model = models[next++];
      outcomes.set(model, await resolver.resolve(model));
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, models.length) }, worker));
  return outcomes;
}

function withinScope(
  byId: Map<string, { parent: string | null }>,
  id: string,
  scope: string
): boolean {
  let current: string | null = id;
  while (current) {
    if (current === scope) return true;
    current = byId.get(current)?.parent ?? null;
  }
  return false;
}

/**
 * Whether the endpoint (or a proposed ancestor hiding it) is filtered out by its own
 * project's `view.proposed`. A proposed endpoint whose project filters proposed content hides
 * the whole claim, and the owning project's switch never overrides that.
 */
function endpointProposedHidden(
  snapshot: ProjectSnapshot,
  project: ProjectState,
  elementId: string
): boolean {
  const byId = new Map(snapshot.model.elements.map((element) => [element.id, element]));
  let current = byId.get(elementId);
  while (current) {
    if (current.status === 'proposed' && !project.view.proposed) return true;
    current = current.parent === null ? undefined : byId.get(current.parent);
  }
  return false;
}

/**
 * The visible stand-in for an authored endpoint under its own project's collapsed/view state.
 * Collapse resolves to a visible ancestor node; only scope exclusion reaches a perimeter port.
 * Proposal filtering is decided upstream (`endpointProposedHidden`), so a port never stands in
 * for a proposed-hidden endpoint.
 */
function representative(
  snapshot: ProjectSnapshot,
  project: ProjectState,
  composed: { mode: 'open' | 'collapsed'; diagram: Diagram | null },
  elementId: string
): BridgeRepresentative {
  if (composed.mode === 'collapsed' || !composed.diagram) return { kind: 'project' };
  const byId = new Map(snapshot.model.elements.map((element) => [element.id, element]));
  // Validated upstream; an unknown element stays total by standing in the whole project.
  if (!byId.has(elementId)) return { kind: 'project' };
  const nodeIds = new Set(composed.diagram.nodes.map((node) => node.id));
  if (nodeIds.has(elementId)) return { kind: 'node', id: elementId };
  let parent = byId.get(elementId)?.parent ?? null;
  while (parent) {
    if (nodeIds.has(parent)) return { kind: 'node', id: parent };
    parent = byId.get(parent)?.parent ?? null;
  }
  const scope = project.view.scope;
  if (scope !== undefined && !withinScope(byId, elementId, scope))
    return { kind: 'port', reason: 'outside-scope' };
  // An eligible in-scope endpoint always resolves to a visible ancestor under the same view,
  // so reaching here means the diagram disagrees: stand in the whole project, never a port.
  return { kind: 'project' };
}

/** The frame side facing the other endpoint's project; mirrors the routing axis choice. */
function portSide(from: Frame, to: Frame): PortSide {
  if (routeAxis(from, to) === 'horizontal')
    return to.x + to.width / 2 >= from.x + from.width / 2 ? 'right' : 'left';
  return to.y + to.height / 2 >= from.y + from.height / 2 ? 'bottom' : 'top';
}

const SIDE_ORDER: PortSide[] = ['left', 'right', 'top', 'bottom'];

/**
 * Evenly spaced slot along one side, in composed coordinates. Side ports start below the
 * title band so bridge segments never cross it; top/bottom ports span the full width.
 */
function portGroupPoints(
  frame: Frame,
  titleHeight: number,
  side: PortSide,
  sizes: readonly { width: number; height: number }[],
  bodyBottom?: number
): Point[] {
  if (side === 'left' || side === 'right') {
    const top = frame.y + titleHeight;
    const bottom = bodyBottom ?? frame.y + frame.height;
    const occupied = sizes.reduce((sum, size) => sum + size.height, 0);
    const gaps = Math.max(0, sizes.length - 1) * COMPOSITION_PORT_GAP;
    let cursor = top + Math.max(0, (bottom - top - occupied - gaps) / 2);
    return sizes.map((size) => {
      const point = {
        x: side === 'left' ? frame.x : frame.x + frame.width,
        y: cursor + size.height / 2
      };
      cursor += size.height + COMPOSITION_PORT_GAP;
      return point;
    });
  }
  const occupied = sizes.reduce((sum, size) => sum + size.width, 0);
  const gaps = Math.max(0, sizes.length - 1) * COMPOSITION_PORT_GAP;
  let cursor = frame.x + Math.max(0, (frame.width - occupied - gaps) / 2);
  return sizes.map((size) => {
    const point = {
      x: cursor + size.width / 2,
      y: side === 'top' ? frame.y : frame.y + frame.height
    };
    cursor += size.width + COMPOSITION_PORT_GAP;
    return point;
  });
}

/** Bridge and port labels show the title, with `×N` when N claims share one drawn bridge. */
function countedLabel(title: string, count: number): string {
  return count > 1 ? `${title} ×${count}` : title;
}

function endpointTitle(snapshot: ProjectSnapshot, elementId: string): string {
  return snapshot.model.elements.find((element) => element.id === elementId)?.title ?? elementId;
}

interface RawEndpoint {
  model: string;
  element: string;
  representative: BridgeRepresentative;
}

interface RawBridge {
  owner: string;
  connection: ProjectConnection;
  source: RawEndpoint;
  target: RawEndpoint;
}

/**
 * Bundling identity: the visible representative pair plus the shared claim fields. Node and
 * project stand-ins are compared by drawn card (model plus node); each perimeter port is a
 * distinct drawn stand-in with its own reveal action, so ports also compare the endpoint
 * element and only claims through the same port bundle. Direction matters: reversed claims
 * never share a key.
 */
function bundleKey(bridge: RawBridge): string {
  const part = (endpoint: RawEndpoint): unknown[] =>
    endpoint.representative.kind === 'port'
      ? ['port', endpoint.model, endpoint.element]
      : endpoint.representative.kind === 'node'
        ? ['node', endpoint.model, endpoint.representative.id]
        : ['project', endpoint.model];
  return JSON.stringify([
    part(bridge.source),
    part(bridge.target),
    bridge.connection.kind,
    bridge.connection.status,
    bridge.connection.title,
    bridge.connection.description
  ]);
}

function validateLinks(
  snapshot: ProjectSnapshot,
  resolved: Map<string, ProjectSnapshot>,
  diagnostics: CompositionDiagnostic[]
): { badLinks: Set<string>; badConnections: Set<string> } {
  const badLinks = new Set<string>();
  const badConnections = new Set<string>();
  const links = snapshot.links;
  if (!links) return { badLinks, badConnections };
  links.links.forEach((link, index) => {
    if (link.from === undefined) return;
    const path = `links.links[${index}].from`;
    const target = {
      model: link.target.model,
      ...(link.target.scene ? { scene: link.target.scene } : {})
    };
    if (!snapshot.model.elements.some((element) => element.id === link.from)) {
      diagnostics.push({
        code: 'endpoint_missing',
        ownerModel: snapshot.id,
        message: `The authored link element ${link.from} is missing.`,
        linkId: link.id,
        target,
        path,
        recovery: 'repair'
      });
      badLinks.add(link.id);
    } else if (snapshot.origins.elements[link.from] !== 'explicit') {
      diagnostics.push({
        code: 'identity_not_explicit',
        ownerModel: snapshot.id,
        message: `The authored link element ${link.from} has no explicit stable UID.`,
        linkId: link.id,
        target,
        path,
        recovery: 'repair'
      });
      badLinks.add(link.id);
    }
  });
  links.connections.forEach((connection, index) => {
    for (const [name, ref] of [
      ['source', connection.source],
      ['target', connection.target]
    ] as const) {
      const endpoint = resolved.get(ref.model);
      if (!endpoint) continue;
      const path = `links.connections[${index}].${name}`;
      const target = { model: ref.model, element: ref.element };
      if (!endpoint.model.elements.some((element) => element.id === ref.element)) {
        diagnostics.push({
          code: 'endpoint_missing',
          ownerModel: snapshot.id,
          message: `The authored ${name} element ${ref.element} is missing from ${ref.model}.`,
          connectionId: connection.id,
          target,
          path,
          recovery: 'repair'
        });
        badConnections.add(connection.id);
      } else if (endpoint.origins.elements[ref.element] !== 'explicit') {
        diagnostics.push({
          code: 'identity_not_explicit',
          ownerModel: snapshot.id,
          message: `The authored ${name} element ${ref.element} has no explicit stable UID.`,
          connectionId: connection.id,
          target,
          path,
          recovery: 'repair'
        });
        badConnections.add(connection.id);
      }
    }
  });
  return { badLinks, badConnections };
}

function failureRecovery(code: Failure['code']): CompositionDiagnostic['recovery'] {
  if (code === 'model_unavailable') return 'register';
  if (code === 'unsupported_version') return 'upgrade';
  return 'repair';
}

/**
 * Drop unknown expanded ids and an unknown or proposal-hidden scope so `layout()` can run.
 * The original state is left intact; diagnostics name the owning project and field.
 */
function sanitizeView(
  snapshot: ProjectSnapshot,
  project: ProjectState,
  index: number,
  diagnostics: CompositionDiagnostic[]
): ProjectState['view'] {
  const byId = new Map(snapshot.model.elements.map((element) => [element.id, element]));
  const expanded = project.view.expanded.filter((id) => {
    if (byId.has(id)) return true;
    diagnostics.push({
      code: 'endpoint_missing',
      ownerModel: project.model,
      message: `Expanded element ${id} is missing from ${project.model}.`,
      path: `composition.projects[${index}].view.expanded`,
      target: { model: project.model, element: id },
      recovery: 'repair'
    });
    return false;
  });
  let scope = project.view.scope;
  if (scope !== undefined) {
    const element = byId.get(scope);
    const hidden = element !== undefined && endpointProposedHidden(snapshot, project, scope);
    if (element === undefined || hidden) {
      diagnostics.push({
        code: 'endpoint_missing',
        ownerModel: project.model,
        message:
          element === undefined
            ? `Scope ${scope} is missing from ${project.model}.`
            : `Scope ${scope} is hidden by the proposal filter in ${project.model}.`,
        path: `composition.projects[${index}].view.scope`,
        target: { model: project.model, element: scope },
        recovery: 'repair'
      });
      scope = undefined;
    }
  }
  return {
    expanded,
    proposed: project.view.proposed,
    lens: project.view.lens,
    ...(scope === undefined ? {} : { scope })
  };
}

function stubState(model: string, failed: Map<string, Failure>): ReferenceStub['state'] {
  const failure = failed.get(model);
  if (!failure) return 'not_loaded';
  return failure.code === 'model_unavailable' ? 'unavailable' : 'invalid';
}

/**
 * Resolve, validate, lay out locally, place frames globally and route bridges. Pure over the
 * resolver: no filesystem access, no mutation of inputs, and `deepEqual` results across calls.
 */
export async function compose(
  resolver: SnapshotResolver,
  state: CompositionState
): Promise<ComposedDiagram> {
  const normalized = parseCompositionState(state);
  const projectStates = normalized.projects;
  const outcomes = await resolveAll(
    resolver,
    projectStates.map((project) => project.model)
  );

  const rootProject = projectStates[0];
  const rootOutcome = outcomes.get(rootProject.model)!;
  if (rootOutcome.status !== 'resolved')
    throw new Error(
      `Root project ${rootProject.model} could not be resolved: ${rootOutcome.message}`
    );

  const resolved = new Map<string, ProjectSnapshot>();
  const failed = new Map<string, Failure>();
  for (const project of projectStates) {
    const outcome = outcomes.get(project.model)!;
    if (outcome.status === 'resolved') resolved.set(project.model, outcome.snapshot);
    else failed.set(project.model, outcome);
  }

  const diagnostics: CompositionDiagnostic[] = [];
  for (const [model, failure] of failed) {
    const owner = projectStates.find(
      (project) =>
        resolved.get(project.model)?.links?.links.some((link) => link.target.model === model) ??
        false
    );
    const ownerModel = owner?.model ?? normalized.root;
    const link = resolved
      .get(ownerModel)
      ?.links?.links.find((candidate) => candidate.target.model === model);
    diagnostics.push({
      code: failure.code,
      ownerModel,
      message: failure.message,
      ...(link ? { linkId: link.id } : {}),
      target: { model },
      recovery: failureRecovery(failure.code)
    });
  }

  const validations = new Map<string, { badLinks: Set<string>; badConnections: Set<string> }>();
  for (const [model, snapshot] of resolved)
    validations.set(model, validateLinks(snapshot, resolved, diagnostics));

  const effectiveScenes = new Map<string, string>();
  projectStates.forEach((project, index) => {
    const snapshot = resolved.get(project.model);
    if (!snapshot) return;
    const named = snapshot.model.scenes.find((scene) => scene.id === project.scene);
    if (project.scene !== undefined && !named) {
      diagnostics.push({
        code: 'scene_missing',
        ownerModel: project.model,
        message: `Scene ${project.scene} is missing from ${project.model}.`,
        path: `composition.projects[${index}].scene`,
        target: { model: project.model, scene: project.scene },
        recovery: 'repair'
      });
    }
    effectiveScenes.set(project.model, (named ?? snapshot.model.scenes[0])?.id ?? '');
  });

  const effectiveProjects: ProjectState[] = projectStates.map((project, index) => {
    const snapshot = resolved.get(project.model);
    if (!snapshot) return project;
    return { ...project, view: sanitizeView(snapshot, project, index, diagnostics) };
  });

  const diagrams = new Map<string, Diagram | null>();
  for (const project of effectiveProjects) {
    const snapshot = resolved.get(project.model);
    if (!snapshot) continue;
    if (project.mode === 'collapsed') {
      diagrams.set(project.model, null);
      continue;
    }
    diagrams.set(
      project.model,
      await layout(snapshot.model, {
        ...project.view,
        theme: normalized.theme,
        layout: normalized.layout
      })
    );
  }

  const placed = placeFrames(
    effectiveProjects
      .filter((project) => resolved.has(project.model))
      .map((project) => ({
        model: project.model,
        title: resolved.get(project.model)!.model.title,
        mode: project.mode,
        diagram: diagrams.get(project.model) ?? null,
        engine: normalized.layout
      }))
  );
  const framesByModel = new Map(placed.projects.map((project) => [project.model, project]));
  const stubs: ReferenceStub[] = [];
  const hidden: HiddenClaim[] = [];
  const raws: RawBridge[] = [];
  for (const project of effectiveProjects) {
    const snapshot = resolved.get(project.model);
    if (!snapshot?.links) continue;
    const validation = validations.get(project.model)!;
    for (const connection of snapshot.links.connections) {
      if (validation.badConnections.has(connection.id)) continue;
      if (!resolved.has(connection.source.model) || !resolved.has(connection.target.model))
        continue;
      // A proposed claim draws only when its owner shows proposed content; otherwise the
      // claim is hidden (never a port) so inspection and CLI can explain it.
      if (connection.status === 'proposed' && !project.view.proposed) {
        hidden.push({
          owner: project.model,
          connectionId: connection.id,
          reason: 'proposed-owner'
        });
        continue;
      }
      // Each endpoint must be eligible under its own project's view. A proposed endpoint
      // whose project filters proposed content hides the claim; the owner's switch never
      // overrides that.
      const sourceState = effectiveProjects.find(
        (entry) => entry.model === connection.source.model
      )!;
      const targetState = effectiveProjects.find(
        (entry) => entry.model === connection.target.model
      )!;
      const sourceHidden = endpointProposedHidden(
        resolved.get(connection.source.model)!,
        sourceState,
        connection.source.element
      );
      const targetHidden = endpointProposedHidden(
        resolved.get(connection.target.model)!,
        targetState,
        connection.target.element
      );
      if (sourceHidden || targetHidden) {
        // Name the hidden endpoint in check order, so inspection offers the switch
        // that reveals the claim instead of guessing from the endpoints.
        const hiddenEndpoint = sourceHidden ? connection.source : connection.target;
        hidden.push({
          owner: project.model,
          connectionId: connection.id,
          reason: 'proposed-endpoint',
          endpoint: { model: hiddenEndpoint.model, element: hiddenEndpoint.element }
        });
        continue;
      }
      raws.push({
        owner: project.model,
        connection,
        source: {
          model: connection.source.model,
          element: connection.source.element,
          representative: representative(
            resolved.get(connection.source.model)!,
            sourceState,
            framesByModel.get(connection.source.model)!,
            connection.source.element
          )
        },
        target: {
          model: connection.target.model,
          element: connection.target.element,
          representative: representative(
            resolved.get(connection.target.model)!,
            targetState,
            framesByModel.get(connection.target.model)!,
            connection.target.element
          )
        }
      });
    }

    for (const link of snapshot.links.links) {
      if (validation.badLinks.has(link.id)) continue;
      if (resolved.has(link.target.model)) continue;
      stubs.push({
        owner: project.model,
        linkId: link.id,
        anchor: {
          model: project.model,
          ...(link.from === undefined ? {} : { element: link.from })
        },
        target: {
          model: link.target.model,
          ...(link.target.scene === undefined ? {} : { scene: link.target.scene })
        },
        state: stubState(link.target.model, failed),
        title: link.title
      });
    }

    for (const connection of snapshot.links.connections) {
      if (validation.badConnections.has(connection.id)) continue;
      const foreign = foreignEndpoint(project.model, connection);
      if (!foreign || resolved.has(foreign.ref.model)) continue;
      // Proposal eligibility applies to unopened targets too: with the owner's switch off,
      // a proposed claim is hidden just as if the target were open, never stubbed.
      if (connection.status === 'proposed' && !project.view.proposed) {
        hidden.push({
          owner: project.model,
          connectionId: connection.id,
          reason: 'proposed-owner'
        });
        continue;
      }
      if (endpointProposedHidden(snapshot, project, foreign.local.element)) {
        hidden.push({
          owner: project.model,
          connectionId: connection.id,
          reason: 'proposed-endpoint',
          endpoint: { model: foreign.local.model, element: foreign.local.element }
        });
        continue;
      }
      stubs.push({
        owner: project.model,
        connectionId: connection.id,
        anchor: { model: project.model, element: foreign.local.element },
        target: { model: foreign.ref.model, element: foreign.ref.element },
        state: stubState(foreign.ref.model, failed),
        title: connection.title
      });
    }
  }

  stubs.sort(
    (a, b) =>
      compare(a.owner, b.owner) ||
      compare(a.linkId ?? a.connectionId ?? '', b.linkId ?? b.connectionId ?? '')
  );
  // Bundle claims that draw the same visible stand-ins with identical claim fields.
  const grouped = new Map<string, RawBridge[]>();
  for (const raw of raws) {
    const key = bundleKey(raw);
    const members = grouped.get(key);
    if (members) members.push(raw);
    else grouped.set(key, [raw]);
  }
  const bundles = [...grouped.values()].map((members) => {
    members.sort((a, b) => compare(a.owner, b.owner) || compare(a.connection.id, b.connection.id));
    return {
      first: members[0],
      count: members.length,
      underlying: members.map((member) => ({
        owner: member.owner,
        connectionId: member.connection.id
      }))
    };
  });
  bundles.sort(
    (a, b) =>
      compare(a.first.owner, b.first.owner) || compare(a.first.connection.id, b.first.connection.id)
  );

  // One port per outside-scope endpoint element per facing side; claims through the same port
  // share its slot and its count.
  interface PortUse {
    model: string;
    element: string;
    side: PortSide;
    count: number;
  }
  const uses = new Map<string, PortUse>();
  for (const bundle of bundles) {
    const ends = [
      { self: bundle.first.source, other: bundle.first.target },
      { self: bundle.first.target, other: bundle.first.source }
    ];
    for (const { self, other } of ends) {
      if (self.representative.kind !== 'port') continue;
      const side = portSide(
        framesByModel.get(self.model)!.frame,
        framesByModel.get(other.model)!.frame
      );
      const key = `${self.model}\n${side}\n${self.element}`;
      const existing = uses.get(key);
      if (existing) existing.count += bundle.count;
      else uses.set(key, { model: self.model, element: self.element, side, count: bundle.count });
    }
  }
  const useGroups = new Map<string, PortUse[]>();
  for (const use of uses.values()) {
    const key = `${use.model}\n${use.side}`;
    const group = useGroups.get(key);
    if (group) group.push(use);
    else useGroups.set(key, [use]);
  }
  const portLabels = new Map<string, { title: string; lines: string[] }>();
  const bottomPaddingByOwner = new Map<string, number>();
  const ownersWithStubLanes = new Set(stubs.map((stub) => stub.owner));
  for (const use of uses.values()) {
    const key = `${use.model}\n${use.side}\n${use.element}`;
    const title = countedLabel(endpointTitle(resolved.get(use.model)!, use.element), use.count);
    const lines = compositionPortLabelLines(title);
    portLabels.set(key, { title, lines });
    if (use.side === 'bottom') {
      const clearance = compositionPortSize(lines).height + 8;
      bottomPaddingByOwner.set(
        use.model,
        Math.max(bottomPaddingByOwner.get(use.model) ?? 0, clearance)
      );
    }
  }
  const bodyHeightExtraByOwner = new Map<string, number>();
  const minWidthByOwner = new Map<string, number>();
  for (const group of useGroups.values()) {
    group.sort((a, b) => compare(a.element, b.element));
    const project = framesByModel.get(group[0].model)!;
    const sizes = group.map((use) =>
      compositionPortSize(portLabels.get(`${use.model}\n${use.side}\n${use.element}`)!.lines)
    );
    if (group[0].side === 'left' || group[0].side === 'right') {
      const required =
        sizes.reduce((sum, size) => sum + size.height, 0) +
        Math.max(0, sizes.length - 1) * COMPOSITION_PORT_GAP;
      const available =
        referenceStubLaneBodyBottom(project) -
        (project.frame.y + project.titleHeight) +
        (ownersWithStubLanes.has(project.model) ? REFERENCE_STUB_LANE_GAP : 0);
      bodyHeightExtraByOwner.set(
        project.model,
        Math.max(bodyHeightExtraByOwner.get(project.model) ?? 0, required - available, 0)
      );
    } else {
      const required =
        sizes.reduce((sum, size) => sum + size.width, 0) +
        Math.max(0, sizes.length - 1) * COMPOSITION_PORT_GAP;
      minWidthByOwner.set(
        project.model,
        Math.max(minWidthByOwner.get(project.model) ?? 0, required)
      );
    }
  }
  reserveReferenceStubLanes(
    placed.projects,
    stubs,
    diagnostics,
    normalized.layout === 'elk-layered-down',
    { bottomPaddingByOwner, bodyHeightExtraByOwner, minWidthByOwner }
  );
  placed.width = placed.projects.reduce(
    (max, project) => Math.max(max, project.frame.x + project.frame.width),
    0
  );
  placed.height = placed.projects.reduce(
    (max, project) => Math.max(max, project.frame.y + project.frame.height),
    0
  );

  const portPoints = new Map<string, Point>();
  const portsByModel = new Map<string, ComposedPort[]>();
  for (const group of useGroups.values()) {
    const placed = framesByModel.get(group[0].model)!;
    const labels = group.map((use) => portLabels.get(`${use.model}\n${use.side}\n${use.element}`)!);
    const points = portGroupPoints(
      placed.frame,
      placed.titleHeight,
      group[0].side,
      labels.map(({ lines }) => compositionPortSize(lines)),
      ownersWithStubLanes.has(placed.model)
        ? referenceStubLaneBodyBottom(placed) +
            (bodyHeightExtraByOwner.get(placed.model) ?? 0) +
            REFERENCE_STUB_LANE_GAP
        : undefined
    );
    group.forEach((use, index) => {
      const key = `${use.model}\n${use.side}\n${use.element}`;
      const { title, lines: labelLines } = portLabels.get(key)!;
      const point = points[index];
      portPoints.set(key, point);
      const ports = portsByModel.get(use.model);
      const port: ComposedPort = {
        model: use.model,
        side: use.side,
        point,
        title,
        labelLines,
        count: use.count,
        reveal: { model: use.model, element: use.element }
      };
      if (ports) ports.push(port);
      else portsByModel.set(use.model, [port]);
    });
  }
  for (const ports of portsByModel.values())
    ports.sort(
      (a, b) =>
        SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side) ||
        compare(a.reveal.element, b.reveal.element)
    );

  const bridges: ComposedBridge[] = [];
  for (const bundle of bundles) {
    const { first, count, underlying } = bundle;
    const labelLines = wrapText(
      countedLabel(first.connection.title, count),
      EDGE_LABEL_WIDTH,
      EDGE_LABEL_SIZE
    );
    // The side is a pure function of the two frames, so recomputing it here matches the
    // slot assigned above for the same (model, side, element).
    const toRoute = (endpoint: RawEndpoint, other: RawEndpoint): RouteEndpoint => {
      const placed = framesByModel.get(endpoint.model)!;
      const representative = endpoint.representative;
      if (representative.kind === 'node')
        return {
          frame: placed.frame,
          content: placed.content,
          node: placed.diagram?.nodes.find((node) => node.id === representative.id),
          titleHeight: placed.titleHeight
        };
      if (representative.kind === 'port') {
        const side = portSide(placed.frame, framesByModel.get(other.model)!.frame);
        const point = portPoints.get(`${endpoint.model}\n${side}\n${endpoint.element}`)!;
        return {
          frame: placed.frame,
          content: placed.content,
          port: point,
          titleHeight: placed.titleHeight
        };
      }
      return {
        frame: placed.frame,
        content: placed.content,
        titleHeight: placed.titleHeight
      };
    };
    const otherFrames = placed.projects
      .filter(
        (project) => project.model !== first.source.model && project.model !== first.target.model
      )
      .map((project) => project.frame);
    const route = routeBridge(
      toRoute(first.source, first.target),
      toRoute(first.target, first.source),
      labelLines,
      otherFrames
    );
    bridges.push({
      id: first.connection.id,
      title: first.connection.title,
      kind: first.connection.kind,
      status: first.connection.status,
      description: first.connection.description,
      evidence: [...first.connection.evidence],
      owner: first.owner,
      source: {
        model: first.source.model,
        element: first.source.element,
        representative: first.source.representative,
        point: route.sourcePoint
      },
      target: {
        model: first.target.model,
        element: first.target.element,
        representative: first.target.representative,
        point: route.targetPoint
      },
      points: route.points,
      label: route.label,
      labelLines,
      count,
      underlying
    });
  }

  const projects: ComposedProject[] = placed.projects.map((project) => ({
    ...project,
    revision: resolved.get(project.model)!.revision,
    scene: effectiveScenes.get(project.model),
    ports: portsByModel.get(project.model) ?? []
  }));

  bridges.sort((a, b) => compare(a.owner, b.owner) || compare(a.id, b.id));
  hidden.sort((a, b) => compare(a.owner, b.owner) || compare(a.connectionId, b.connectionId));
  diagnostics.sort(
    (a, b) => compare(a.ownerModel, b.ownerModel) || compare(a.path ?? '', b.path ?? '')
  );

  // An above-lane or left-lane escape can leave y < 0 or x < 0. Shift so camera fit and
  // export origin stay at 0 without changing two-frame stacked routes that already escape
  // into positive x.
  const geometryX = [
    ...projects.flatMap((project) => [
      project.frame.x,
      project.frame.x + project.frame.width,
      ...project.ports.map((port) => port.point.x)
    ]),
    ...bridges.flatMap((bridge) => [bridge.label.x, ...bridge.points.map((point) => point.x)])
  ];
  const geometryY = [
    ...projects.flatMap((project) => [
      project.frame.y,
      project.frame.y + project.frame.height,
      ...project.ports.map((port) => port.point.y)
    ]),
    ...bridges.flatMap((bridge) => [bridge.label.y, ...bridge.points.map((point) => point.y)])
  ];
  const minX = geometryX.length ? Math.min(...geometryX) : 0;
  const minY = geometryY.length ? Math.min(...geometryY) : 0;
  const dx = minX < 0 ? -minX : 0;
  const dy = minY < 0 ? -minY : 0;
  if (dx !== 0 || dy !== 0) {
    for (const project of projects) {
      project.frame.x += dx;
      project.frame.y += dy;
      project.content.x += dx;
      project.content.y += dy;
      for (const port of project.ports) {
        port.point.x += dx;
        port.point.y += dy;
      }
    }
    for (const bridge of bridges) {
      bridge.label.x += dx;
      bridge.label.y += dy;
      for (const point of bridge.points) {
        point.x += dx;
        point.y += dy;
      }
      bridge.source.point = bridge.points[0];
      bridge.target.point = bridge.points[bridge.points.length - 1];
    }
  }

  let width = Math.max(
    placed.width + dx,
    ...projects.map((project) => project.frame.x + project.frame.width),
    ...bridges.flatMap((bridge) => [bridge.label.x, ...bridge.points.map((point) => point.x)])
  );
  let height = Math.max(
    placed.height + dy,
    ...projects.map((project) => project.frame.y + project.frame.height),
    ...bridges.flatMap((bridge) => [bridge.label.y, ...bridge.points.map((point) => point.y)])
  );

  const composed: ComposedDiagram = {
    state: normalized,
    projects,
    bridges,
    stubs,
    hidden,
    diagnostics,
    width,
    height
  };
  for (const geometry of referenceStubGeometries(composed).values()) {
    width = Math.max(width, geometry.position.x + geometry.width);
    height = Math.max(height, geometry.position.y + geometry.height);
  }
  composed.width = width;
  composed.height = height;
  return composed;
}

/** The endpoint the authoring project does not own, paired with the local endpoint it anchors to. */
function foreignEndpoint(
  owner: string,
  connection: ProjectConnection
): { ref: ElementReference; local: ElementReference } | undefined {
  if (connection.source.model === owner && connection.target.model !== owner)
    return { ref: connection.target, local: connection.source };
  if (connection.target.model === owner && connection.source.model !== owner)
    return { ref: connection.source, local: connection.target };
  return undefined;
}
