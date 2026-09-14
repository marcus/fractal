import type { Model } from '../core/types';
import type { CompositionDiagnosticCode, IdentityOrigins, ProjectLinks } from './types';

/**
 * A fully parsed project as the composition core consumes it. Loaders and adapters produce
 * snapshots; the core never performs I/O and treats a snapshot as immutable.
 */
export interface ProjectSnapshot {
  /** Catalog ID; always equal to `model.id`. */
  id: string;
  model: Model;
  /** Parsed `links.json`, or null when the project declares no links. */
  links: ProjectLinks | null;
  /** Whether each element and relationship ID was explicitly authored (`uid`) or generated. */
  origins: IdentityOrigins;
  /** Content hash over model.c4, fractal.json, optional sequences.json and optional links.json. */
  revision: string;
}

export type ResolutionFailureCode = Extract<
  CompositionDiagnosticCode,
  'model_unavailable' | 'model_invalid' | 'unsupported_version'
>;

/**
 * The outcome of resolving one model ID. A failure carries no owner: the caller that followed a
 * link wraps it into a `CompositionDiagnostic` with the owning model and link/connection ID.
 */
export type ResolutionOutcome =
  | { status: 'resolved'; snapshot: ProjectSnapshot }
  | { status: 'unavailable' | 'invalid'; code: ResolutionFailureCode; message: string };

/**
 * Resolution adapter contract. Implementations map a model ID to a snapshot through configured
 * catalogs only: no cloning, network fetch, plugin execution or filesystem discovery. The
 * composition core receives a resolver and never reads the filesystem itself.
 */
export interface SnapshotResolver {
  resolve(model: string): Promise<ResolutionOutcome>;
}

/** An in-memory resolver over already-built snapshots, for tests and portable bundles. */
export function staticResolver(snapshots: Iterable<ProjectSnapshot>): SnapshotResolver {
  const byId = new Map<string, ProjectSnapshot>();
  for (const snapshot of snapshots) byId.set(snapshot.id, snapshot);
  return {
    async resolve(model) {
      const snapshot = byId.get(model);
      if (snapshot) return { status: 'resolved', snapshot };
      return {
        status: 'unavailable',
        code: 'model_unavailable',
        message: `Model ${model} is not registered.`
      };
    }
  };
}
