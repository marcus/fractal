import type { Diagram } from '../core/types';
import type { ProjectSnapshot } from './snapshot';
import type { ComposedDiagram, CompositionDiagnostic } from './types';

/**
 * Admission limits for a composition. These are admission gates, not latency promises:
 * exceeding one keeps the last successful view and returns a shared `budget_exceeded`
 * diagnostic instead of silently truncating. Overrides always come from service/CLI
 * configuration objects; untrusted input (URLs, state payloads) can never raise a limit.
 */

export interface CompositionLimits {
  projects: number;
  loadedElements: number;
  relationships: number;
  visibleNodes: number;
  visibleEdges: number;
  /** Largest single-project source payload, in bytes. */
  sourceBytesPerProject: number;
  /** Estimated retained cache payload, in bytes. */
  cacheBytes: number;
}

/** The actual counts a composition presents for admission, in the same shape as the limits. */
export interface CompositionCounts {
  projects: number;
  loadedElements: number;
  relationships: number;
  visibleNodes: number;
  visibleEdges: number;
  /** Largest single-project source payload, in bytes. */
  sourceBytesPerProject: number;
  /** Estimated retained cache payload, in bytes. */
  cacheBytes: number;
}

/** Initial release admission limits from the linked-project plan. */
export const DEFAULT_COMPOSITION_LIMITS: CompositionLimits = {
  projects: 20,
  loadedElements: 10_000,
  relationships: 20_000,
  visibleNodes: 500,
  visibleEdges: 1000,
  sourceBytesPerProject: 5 * 1024 * 1024,
  cacheBytes: 128 * 1024 * 1024
};

const RESOURCES: { field: keyof CompositionLimits; resource: string; label: string }[] = [
  { field: 'projects', resource: 'projects', label: 'Participating projects' },
  { field: 'loadedElements', resource: 'loaded_elements', label: 'Loaded elements' },
  { field: 'relationships', resource: 'relationships', label: 'Loaded relationships' },
  { field: 'visibleNodes', resource: 'visible_nodes', label: 'Visible nodes' },
  { field: 'visibleEdges', resource: 'visible_edges', label: 'Visible edges' },
  { field: 'sourceBytesPerProject', resource: 'source_bytes', label: 'Source bytes per project' },
  { field: 'cacheBytes', resource: 'cache_bytes', label: 'Estimated cache bytes' }
];

/**
 * Check admission counts against limits. Returns one `budget_exceeded` diagnostic per
 * exceeded resource (actual strictly above the limit), in resource order, each carrying
 * `budget: { resource, actual, limit }` and recovery `reduce`. An empty array admits.
 */
export function checkAdmission(
  counts: CompositionCounts,
  limits: CompositionLimits = DEFAULT_COMPOSITION_LIMITS,
  ownerModel = 'composition'
): CompositionDiagnostic[] {
  return RESOURCES.filter(({ field }) => counts[field] > limits[field]).map(
    ({ field, resource, label }): CompositionDiagnostic => ({
      code: 'budget_exceeded',
      ownerModel,
      message: `${label} exceed the composition budget: ${counts[field]} over the limit of ${limits[field]}. Collapse or focus a project to continue.`,
      recovery: 'reduce',
      budget: { resource, actual: counts[field], limit: limits[field] }
    })
  );
}

/**
 * Visible geometry toward the `visibleNodes`/`visibleEdges` gates: laid-out local nodes
 * and edges, plus one visible connection per drawn bridge and one visible stand-in per
 * perimeter port and reference stub. Bridge geometry is resource accounting, not free:
 * a composition of quiet projects joined by hundreds of claims is refused under the
 * same visible gates as a dense local diagram.
 */
export function visibleAdmissionCounts(composed: ComposedDiagram): {
  visibleNodes: number;
  visibleEdges: number;
} {
  let visibleNodes = composed.stubs.length;
  let visibleEdges = composed.bridges.length;
  for (const project of composed.projects) {
    if (project.diagram) {
      visibleNodes += project.diagram.nodes.length;
      visibleEdges += project.diagram.edges.length;
    }
    visibleNodes += project.ports.length;
  }
  return { visibleNodes, visibleEdges };
}

/**
 * Admission counts from resolved snapshots and a composed diagram, shared by the
 * server boundary and the linked HTML export so both gates count the same geometry.
 * Loaded counts cover every resolved snapshot; collapsed projects keep no diagram but
 * their snapshots still load. Source and cache bytes are deterministic
 * serialization-size approximations, not heap measurements. An over-limit composition
 * is refused whole, never truncated.
 */
export function snapshotAdmissionCounts(
  projects: number,
  snapshots: ProjectSnapshot[],
  composed: ComposedDiagram
): CompositionCounts {
  let loadedElements = 0;
  let relationships = 0;
  let sourceBytesPerProject = 0;
  let snapshotBytes = 0;
  for (const snapshot of snapshots) {
    loadedElements += snapshot.model.elements.length;
    relationships += snapshot.model.relationships.length;
    const bytes = estimateBytes(snapshot);
    snapshotBytes += bytes;
    if (bytes > sourceBytesPerProject) sourceBytesPerProject = bytes;
  }
  const { visibleNodes, visibleEdges } = visibleAdmissionCounts(composed);
  return {
    projects,
    loadedElements,
    relationships,
    visibleNodes,
    visibleEdges,
    sourceBytesPerProject,
    cacheBytes: estimateBytes(composed) + snapshotBytes
  };
}

/**
 * The composition exceeds its admission limits. The result is refused whole — never
 * truncated — so the caller collapses, focuses or narrows the composition and retries.
 * Routes translate it to HTTP 422; the CLI exits nonzero. It lives here, beside the
 * counts and the check, so adapters that enforce the gate never import the server
 * boundary to throw it.
 */
export class BudgetExceededError extends Error {
  readonly code = 'budget_exceeded' as const;
  readonly diagnostics: CompositionDiagnostic[];
  constructor(diagnostics: CompositionDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'The composition exceeds its resource budget.');
    this.name = 'BudgetExceededError';
    this.diagnostics = diagnostics;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Deterministic, documented approximation of retained bytes: the UTF-8 length of the
 * canonical (key-sorted) JSON serialization. Equal content always estimates equal bytes
 * regardless of key insertion order. This is a serialization-size approximation for
 * admission accounting, not a heap measurement.
 */
export function estimateBytes(value: ProjectSnapshot | Diagram | ComposedDiagram): number;
export function estimateBytes(value: ProjectSnapshot): number;
export function estimateBytes(value: Diagram): number;
export function estimateBytes(value: ComposedDiagram): number;
export function estimateBytes(value: ProjectSnapshot | Diagram | ComposedDiagram): number {
  return new TextEncoder().encode(canonical(value)).byteLength;
}
