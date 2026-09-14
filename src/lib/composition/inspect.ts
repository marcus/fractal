import { inspectComponent } from '../core/inspect';
import type { Status } from '../core/types';
import type { ProjectSnapshot } from './snapshot';
import type {
  BridgeRepresentative,
  ComposedDiagram,
  ElementReference,
  QualifiedSelection
} from './types';

interface RouteLeg {
  project: string;
  component: string | null;
}

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
  representatives: { source: BridgeRepresentative; target: BridgeRepresentative };
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
  ref: { ownerModel: string; connectionId: string }
): InspectedConnection {
  const bridge = composed.bridges.find(
    (candidate) => candidate.owner === ref.ownerModel && candidate.id === ref.connectionId
  );
  if (!bridge) throw new Error(`Unknown connection: ${ref.ownerModel}/${ref.connectionId}`);
  const component = (endpoint: {
    model: string;
    representative: BridgeRepresentative;
  }): string | null => {
    const rep = endpoint.representative;
    if (rep.kind !== 'node') return null;
    const project = composed.projects.find((candidate) => candidate.model === endpoint.model);
    return project?.diagram?.nodes.find((node) => node.id === rep.id)?.title ?? null;
  };
  return {
    kind: 'connection',
    owner: bridge.owner,
    route: {
      source: {
        project: projectTitle(composed, bridge.source.model, bridge.source.model),
        component: component(bridge.source)
      },
      target: {
        project: projectTitle(composed, bridge.target.model, bridge.target.model),
        component: component(bridge.target)
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
      source: bridge.source.representative,
      target: bridge.target.representative
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
    return inspectConnection(composed, {
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
