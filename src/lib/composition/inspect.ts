import { inspectComponent } from '../core/inspect';
import type { Model, Status } from '../core/types';
import type { ProjectSnapshot } from './snapshot';
import type {
  BridgeRepresentative,
  ComposedDiagram,
  ElementReference,
  ProjectLinks,
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

/** One authored claim inside a (possibly bundled) bridge, with its exact provenance. */
export interface UnderlyingClaim {
  owner: string;
  connectionId: string;
  endpoints: { source: ElementReference; target: ElementReference };
  evidence: string[];
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
  representatives: { source: InspectedRepresentative; target: InspectedRepresentative };
  /** Bundle size; 1 when the bridge draws a single claim. */
  count: number;
  /**
   * Every underlying claim with its owner, exact endpoints and evidence, in bridge order.
   * Unrelated claims are listed side by side, never merged.
   */
  underlying: UnderlyingClaim[];
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

/**
 * Qualified inspection of one bridge. Exact authored endpoints stay separate from their
 * stand-ins. `ref` may name any underlying claim in a bundle, not just the drawn
 * representative: the shared route, claim fields and drawn stand-ins stay the same while
 * `endpoints` and the claim evidence describe the requested claim, and `underlying` lists
 * every claim in the bundle. `linksOf` resolves exact endpoints and evidence per claim;
 * without it those fall back to the drawn bridge (exact for unbundled bridges).
 */
export function inspectConnection(
  composed: ComposedDiagram,
  lookup: ModelLookup,
  ref: { ownerModel: string; connectionId: string },
  linksOf?: (model: string) => ProjectLinks | null
): InspectedConnection {
  const bridge = composed.bridges.find((candidate) =>
    candidate.underlying.some(
      (entry) => entry.owner === ref.ownerModel && entry.connectionId === ref.connectionId
    )
  );
  if (!bridge) throw new Error(`Unknown connection: ${ref.ownerModel}/${ref.connectionId}`);
  const detailOf = (owner: string, connectionId: string): UnderlyingClaim => {
    const authored = linksOf?.(owner)?.connections.find(
      (candidate) => candidate.id === connectionId
    );
    if (authored)
      return {
        owner,
        connectionId,
        endpoints: {
          source: { ...authored.source },
          target: { ...authored.target }
        },
        evidence: [...authored.evidence]
      };
    return {
      owner,
      connectionId,
      endpoints: {
        source: { model: bridge.source.model, element: bridge.source.element },
        target: { model: bridge.target.model, element: bridge.target.element }
      },
      evidence: [...bridge.evidence]
    };
  };
  const requested = detailOf(ref.ownerModel, ref.connectionId);
  const underlying = bridge.underlying.map((entry) => detailOf(entry.owner, entry.connectionId));
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
        project: projectTitle(composed, requested.endpoints.source.model, bridge.source.model),
        component: endpointTitle(
          requested.endpoints.source.model,
          requested.endpoints.source.element
        )
      },
      target: {
        project: projectTitle(composed, requested.endpoints.target.model, bridge.target.model),
        component: endpointTitle(
          requested.endpoints.target.model,
          requested.endpoints.target.element
        )
      }
    },
    claim: {
      title: bridge.title,
      kind: bridge.kind,
      status: bridge.status,
      description: bridge.description,
      evidence: [...requested.evidence]
    },
    endpoints: {
      source: { ...requested.endpoints.source },
      target: { ...requested.endpoints.target }
    },
    representatives: {
      source: representative(bridge.source),
      target: representative(bridge.target)
    },
    count: bridge.count,
    underlying
  };
}

/** One qualified inspection entry point shared by CLI and studio. */
export function inspectQualified(
  composed: ComposedDiagram,
  snapshots: Map<string, ProjectSnapshot>,
  selection: QualifiedSelection
): QualifiedInspection {
  if (selection.kind === 'connection')
    return inspectConnection(
      composed,
      (model) => snapshots.get(model)?.model,
      {
        ownerModel: selection.ownerModel,
        connectionId: selection.connectionId
      },
      (model) => snapshots.get(model)?.links ?? null
    );
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
