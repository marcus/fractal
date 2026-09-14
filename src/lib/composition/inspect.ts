import { inspectComponent } from '../core/inspect';
import type { Model, Status } from '../core/types';
import type { ProjectSnapshot } from './snapshot';
import type {
  BridgeRepresentative,
  ComposedDiagram,
  ElementReference,
  QualifiedSelection
} from './types';

interface RouteLeg {
  project: string;
  /** The exact authored endpoint element title, never its drawn representative. */
  component: string | null;
}

/** Where a bridge actually meets the canvas: the visible stand-in for an endpoint. */
export interface InspectedRepresentative {
  model: string;
  element: string;
  representative: BridgeRepresentative;
  title: string | null;
}

/** Resolve a participating project's model so a route leg can name the exact endpoint title. */
export type ModelLookup = (model: string) => Model | undefined;

export interface InspectedConnection {
  kind: 'connection';
  owner: string;
  route: { source: RouteLeg; target: RouteLeg };
  claim: {
    title: string;
    kind: string;
    status: Status;
    description: string;
    evidence: string[];
  };
  endpoints: { source: ElementReference; target: ElementReference };
  representatives: { source: InspectedRepresentative; target: InspectedRepresentative };
}

export type InspectedElement = ReturnType<typeof inspectComponent> & {
  kind: 'element';
  model: string;
  project: string;
};

export interface InspectedProject {
  kind: 'project';
  model: string;
  title: string;
  mode: 'open' | 'collapsed';
  scene?: string;
  counts: { elements: number; relationships: number; boundaries: number; scenes: number };
}

export type QualifiedInspection = InspectedElement | InspectedProject | InspectedConnection;

function projectTitle(composed: ComposedDiagram, model: string, fallback: string): string {
  return composed.projects.find((project) => project.model === model)?.title ?? fallback;
}

/** Qualified inspection of one bridge. Exact authored endpoints stay separate from their stand-ins. */
export function inspectConnection(
  composed: ComposedDiagram,
  lookup: ModelLookup,
  ref: { ownerModel: string; connectionId: string }
): InspectedConnection {
  const bridge = composed.bridges.find(
    (candidate) => candidate.owner === ref.ownerModel && candidate.id === ref.connectionId
  );
  if (!bridge) throw new Error(`Unknown connection: ${ref.ownerModel}/${ref.connectionId}`);
  const endpointTitle = (model: string, element: string): string | null =>
    lookup(model)?.elements.find((candidate) => candidate.id === element)?.title ?? null;
  const representative = (endpoint: {
    model: string;
    element: string;
    representative: BridgeRepresentative;
  }): InspectedRepresentative => {
    const rep = endpoint.representative;
    const title =
      rep.kind === 'node'
        ? (composed.projects
            .find((candidate) => candidate.model === endpoint.model)
            ?.diagram?.nodes.find((node) => node.id === rep.id)?.title ?? null)
        : null;
    return {
      model: endpoint.model,
      element: endpoint.element,
      representative: rep,
      title
    };
  };
  return {
    kind: 'connection',
    owner: bridge.owner,
    route: {
      source: {
        project: projectTitle(composed, bridge.source.model, bridge.source.model),
        component: endpointTitle(bridge.source.model, bridge.source.element)
      },
      target: {
        project: projectTitle(composed, bridge.target.model, bridge.target.model),
        component: endpointTitle(bridge.target.model, bridge.target.element)
      }
    },
    claim: {
      title: bridge.title,
      kind: bridge.kind,
      status: bridge.status,
      description: bridge.description,
      evidence: [...bridge.evidence]
    },
    endpoints: {
      source: { model: bridge.source.model, element: bridge.source.element },
      target: { model: bridge.target.model, element: bridge.target.element }
    },
    representatives: {
      source: representative(bridge.source),
      target: representative(bridge.target)
    }
  };
}

/** One qualified inspection entry point shared by CLI and studio. */
export function inspectQualified(
  composed: ComposedDiagram,
  snapshots: Map<string, ProjectSnapshot>,
  selection: QualifiedSelection
): QualifiedInspection {
  if (selection.kind === 'connection')
    return inspectConnection(composed, (model) => snapshots.get(model)?.model, {
      ownerModel: selection.ownerModel,
      connectionId: selection.connectionId
    });
  if (selection.kind === 'element') {
    const project = composed.state.projects.find((entry) => entry.model === selection.model);
    const snapshot = snapshots.get(selection.model);
    if (!project || !snapshot) throw new Error(`Unknown element project: ${selection.model}`);
    return {
      kind: 'element',
      model: selection.model,
      project: snapshot.model.title,
      ...inspectComponent(snapshot.model, selection.element, {
        proposed: project.view.proposed
      })
    };
  }
  if (selection.kind === 'project') {
    const project = composed.state.projects.find((entry) => entry.model === selection.model);
    const snapshot = snapshots.get(selection.model);
    if (!project || !snapshot) throw new Error(`Unknown project: ${selection.model}`);
    return {
      kind: 'project',
      model: selection.model,
      title: snapshot.model.title,
      mode: project.mode,
      ...(composed.projects.find((entry) => entry.model === selection.model)?.scene === undefined
        ? {}
        : { scene: composed.projects.find((entry) => entry.model === selection.model)!.scene }),
      counts: {
        elements: snapshot.model.elements.length,
        relationships: snapshot.model.relationships.length,
        boundaries: snapshot.model.boundaries.length,
        scenes: snapshot.model.scenes.length
      }
    };
  }
  throw new Error(`Selection kind ${selection.kind} is not supported in phase 1`);
}
