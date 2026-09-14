import { layout } from '../core/layout';
import { EDGE_LABEL_SIZE, EDGE_LABEL_WIDTH } from '../core/measure';
import { wrapText } from '../core/projection';
import type { Diagram } from '../core/types';
import { parseCompositionState } from './parse';
import { placeFrames } from './place';
import { routeBridge } from './route';
import type { RouteEndpoint } from './route';
import type { ProjectSnapshot, ResolutionOutcome, SnapshotResolver } from './snapshot';
import type {
  BridgeRepresentative,
  ComposedBridge,
  ComposedDiagram,
  ComposedProject,
  CompositionDiagnostic,
  CompositionState,
  ElementReference,
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

/** The visible stand-in for an authored endpoint under its own project's collapsed/view state. */
function representative(
  snapshot: ProjectSnapshot,
  project: ProjectState,
  composed: ComposedProject,
  elementId: string
): BridgeRepresentative {
  if (composed.mode === 'collapsed' || !composed.diagram) return { kind: 'project' };
  const nodeIds = new Set(composed.diagram.nodes.map((node) => node.id));
  if (nodeIds.has(elementId)) return { kind: 'node', id: elementId };
  const byId = new Map(snapshot.model.elements.map((element) => [element.id, element]));
  let parent = byId.get(elementId)?.parent ?? null;
  while (parent) {
    if (nodeIds.has(parent)) return { kind: 'node', id: parent };
    parent = byId.get(parent)?.parent ?? null;
  }
  const scope = project.view.scope;
  const reason =
    scope !== undefined && !withinScope(byId, elementId, scope) ? 'outside-scope' : 'hidden';
  return { kind: 'port', reason };
}

function routeEndpoint(
  snapshot: ProjectSnapshot,
  project: ProjectState,
  composed: ComposedProject,
  elementId: string
): { representative: BridgeRepresentative; route: RouteEndpoint } {
  const rep = representative(snapshot, project, composed, elementId);
  if (rep.kind === 'node') {
    const node = composed.diagram?.nodes.find((candidate) => candidate.id === rep.id);
    return {
      representative: rep,
      route: { frame: composed.frame, content: composed.content, node }
    };
  }
  return { representative: rep, route: { frame: composed.frame, content: composed.content } };
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

  const diagrams = new Map<string, Diagram | null>();
  for (const project of projectStates) {
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
    projectStates
      .filter((project) => resolved.has(project.model))
      .map((project) => ({
        model: project.model,
        title: resolved.get(project.model)!.model.title,
        mode: project.mode,
        diagram: diagrams.get(project.model) ?? null,
        engine: normalized.layout
      }))
  );
  const projects: ComposedProject[] = placed.projects.map((project) => ({
    ...project,
    revision: resolved.get(project.model)!.revision,
    scene: effectiveScenes.get(project.model)
  }));
  const composedByModel = new Map(projects.map((project) => [project.model, project]));

  const bridges: ComposedBridge[] = [];
  const stubs: ReferenceStub[] = [];
  for (const project of projectStates) {
    const snapshot = resolved.get(project.model);
    if (!snapshot?.links) continue;
    const validation = validations.get(project.model)!;
    for (const connection of snapshot.links.connections) {
      if (validation.badConnections.has(connection.id)) continue;
      if (!resolved.has(connection.source.model) || !resolved.has(connection.target.model))
        continue;
      if (connection.status === 'proposed' && !project.view.proposed) continue;
      const sourceState = projectStates.find((entry) => entry.model === connection.source.model)!;
      const targetState = projectStates.find((entry) => entry.model === connection.target.model)!;
      const source = routeEndpoint(
        resolved.get(connection.source.model)!,
        sourceState,
        composedByModel.get(connection.source.model)!,
        connection.source.element
      );
      const target = routeEndpoint(
        resolved.get(connection.target.model)!,
        targetState,
        composedByModel.get(connection.target.model)!,
        connection.target.element
      );
      const hidden = (rep: BridgeRepresentative): boolean =>
        rep.kind === 'port' && rep.reason === 'hidden';
      if (hidden(source.representative) || hidden(target.representative)) continue;
      const labelLines = wrapText(connection.title, EDGE_LABEL_WIDTH, EDGE_LABEL_SIZE);
      const route = routeBridge(source.route, target.route, labelLines);
      bridges.push({
        ...connection,
        evidence: [...connection.evidence],
        owner: project.model,
        source: {
          model: connection.source.model,
          element: connection.source.element,
          representative: source.representative,
          point: route.sourcePoint
        },
        target: {
          model: connection.target.model,
          element: connection.target.element,
          representative: target.representative,
          point: route.targetPoint
        },
        points: route.points,
        label: route.label,
        labelLines
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

  bridges.sort((a, b) => compare(a.owner, b.owner) || compare(a.id, b.id));
  stubs.sort(
    (a, b) =>
      compare(a.owner, b.owner) ||
      compare(a.linkId ?? a.connectionId ?? '', b.linkId ?? b.connectionId ?? '')
  );
  diagnostics.sort(
    (a, b) => compare(a.ownerModel, b.ownerModel) || compare(a.path ?? '', b.path ?? '')
  );

  return {
    state: normalized,
    projects,
    bridges,
    stubs,
    diagnostics,
    width: placed.width,
    height: placed.height
  };
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
