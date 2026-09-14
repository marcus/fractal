import { renderPng } from '../adapters/png';
import { exportCompositionSvg } from '../composition/svg';
import type {
  ComposedDiagram,
  CompositionDiagnostic,
  CompositionState
} from '../composition/types';
import type { Model } from '../core/types';
import {
  composeFromSelector,
  type CompositionRequest,
  type CompositionSelector
} from './composition';
import type { ProjectSnapshot } from '../composition/snapshot';
import { catalogResolver } from './models';

/**
 * The export boundary for linked compositions: the CLI and the HTTP export route both
 * call `exportComposition`, so unresolved-target policy, the diagnostic manifest and the
 * SVG/PNG rendering never diverge between surfaces. Single-model export never enters
 * here; its bytes stay exactly as rendered before.
 */

export type CompositionExportFormat = 'svg' | 'png';

/** A project that drew in the export, with the content revision that drew. */
export interface ExportProject {
  model: string;
  revision: string;
  scene?: string;
  mode: 'open' | 'collapsed';
}

/** An authored link left out on purpose: its target was never opened, so it is listed, not resolved. */
export interface ExportOmission {
  owner: string;
  linkId?: string;
  connectionId?: string;
  target: { model: string; element?: string; scene?: string };
  title: string;
}

/**
 * The JSON report every composition export returns. `omitted` names intentional
 * unopened-link stubs (never errors); `unresolved` carries the failure diagnostics of
 * participating targets (empty unless `allowUnresolved` produced the export).
 */
export interface ExportManifest {
  version: 1;
  format: CompositionExportFormat;
  root: string;
  composition?: string;
  state: CompositionState;
  projects: ExportProject[];
  omitted: ExportOmission[];
  unresolved: CompositionDiagnostic[];
  output?: string;
}

/** Resolution failures: a participating target that could not be read. */
const FAILURE_CODES: CompositionDiagnostic['code'][] = [
  'model_unavailable',
  'model_invalid',
  'unsupported_version'
];

/**
 * A participating target failed and the caller did not allow unresolved output. The CLI
 * exits nonzero; HTTP answers 422. The diagnostics name every failed target with its
 * owner and recovery action.
 */
export class ExportUnresolvedError extends Error {
  readonly code = 'export_unresolved' as const;
  readonly diagnostics: CompositionDiagnostic[];
  constructor(diagnostics: CompositionDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'A participating project could not be resolved for export.');
    this.name = 'ExportUnresolvedError';
    this.diagnostics = diagnostics;
  }
}

/** Failed participating targets in a composed result, in composed diagnostic order. */
export function unresolvedTargets(composed: ComposedDiagram): CompositionDiagnostic[] {
  return composed.diagnostics.filter((diagnostic) => FAILURE_CODES.includes(diagnostic.code));
}

/** Intentional omissions: authored stubs whose target stays unopened, never resolved here. */
export function omittedLinks(composed: ComposedDiagram): ExportOmission[] {
  return composed.stubs
    .filter((stub) => stub.state === 'not_loaded')
    .map((stub) => ({
      owner: stub.owner,
      ...(stub.linkId === undefined ? {} : { linkId: stub.linkId }),
      ...(stub.connectionId === undefined ? {} : { connectionId: stub.connectionId }),
      target: stub.target,
      title: stub.title
    }));
}

export function buildExportManifest(
  composed: ComposedDiagram,
  revisions: Record<string, string>,
  format: CompositionExportFormat,
  output?: string
): ExportManifest {
  return {
    version: 1,
    format,
    root: composed.state.root,
    ...(composed.state.composition === undefined
      ? {}
      : { composition: composed.state.composition }),
    state: composed.state,
    projects: composed.projects.map((project) => ({
      model: project.model,
      revision: revisions[project.model] ?? project.revision,
      ...(project.scene === undefined ? {} : { scene: project.scene }),
      mode: project.mode
    })),
    omitted: omittedLinks(composed),
    unresolved: unresolvedTargets(composed),
    ...(output === undefined ? {} : { output })
  };
}

export interface CompositionExportOptions extends CompositionRequest {
  format?: CompositionExportFormat;
  /**
   * Render despite failed participating targets: they draw as unavailable cards and
   * their diagnostics travel in the manifest. Without it the export fails instead.
   */
  allowUnresolved?: boolean;
}

export interface CompositionExport {
  svg: string;
  png?: Buffer;
  manifest: ExportManifest;
}

/**
 * Compose the requested composition, enforce the unresolved-target policy, then allocate
 * output. Admission limits are already checked inside `composeFromSelector`, so an
 * over-limit composition is refused before any SVG string or PNG is allocated; larger
 * exports need an explicit local limit override and a measured run.
 */
export async function exportComposition(
  root: string | ProjectSnapshot,
  selector: CompositionSelector,
  options: CompositionExportOptions = {}
): Promise<CompositionExport> {
  const format = options.format ?? 'svg';
  const { composed, revisions } = await composeFromSelector(root, selector, options);
  const unresolved = unresolvedTargets(composed);
  if (unresolved.length > 0 && options.allowUnresolved !== true)
    throw new ExportUnresolvedError(unresolved);

  const resolver = catalogResolver(options);
  const models: Record<string, Model> = {};
  for (const project of composed.projects) {
    const outcome = await resolver.resolve(project.model);
    if (outcome.status === 'resolved') models[project.model] = outcome.snapshot.model;
  }
  const svg = exportCompositionSvg(composed, models);
  const png = format === 'png' ? await renderPng(svg, { fullPage: true }) : undefined;
  return {
    svg,
    ...(png === undefined ? {} : { png }),
    manifest: buildExportManifest(composed, revisions, format)
  };
}
