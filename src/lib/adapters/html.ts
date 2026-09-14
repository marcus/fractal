import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compose } from '../composition/compose';
import { openProject, rootState, stateFromComposition } from '../composition/state';
import { staticResolver, type ProjectSnapshot } from '../composition/snapshot';
import type { CompositionState } from '../composition/types';
import { layout } from '../core/layout';
import {
  collectExcludedLinks,
  LINKED_CONTRACT_VERSION,
  linkedHtmlReport,
  linkedPortableHtml,
  linkedSnapshots,
  portableHtml,
  snapshotsForResolver,
  type LinkedHtmlReport,
  type PortableLinkedDocument,
  type PortableLinkedSnapshot
} from '../portable/document';
import type { Diagram, Model, ViewState } from '../core/types';
import type { SequenceJourney } from '../sequence/types';

let assets: Promise<{ js: string; css: string; notices?: string }> | undefined;

export type HtmlExportAssets = { js: string; css: string; notices?: string };

export interface HtmlExportOptions {
  state: ViewState;
  scene?: string;
  sequences?: SequenceJourney[];
  assets?: HtmlExportAssets;
  /**
   * Where the geometry comes from. The default lays the view out here; a server that already
   * has this view laid out passes its own source so the export reuses it. Called only after the
   * scene is known to exist, so validation still reports the scene first.
   */
  diagram?: () => Promise<Diagram>;
  /**
   * Extra catalog IDs to embed with the root. Presence selects linked-document export; the root
   * is always included. Omit for the existing single-model document.
   */
  include?: string[];
  /** Preloaded snapshots covering the root and every included id. Required when `include` is set. */
  snapshots?: ProjectSnapshot[];
  sequencesByModel?: Record<string, SequenceJourney[]>;
  /** Optional authored composition ID; ignored unless `include` is set. */
  composition?: string;
  /** Explicit composition state to replay; mutually exclusive with `composition`. */
  compositionState?: CompositionState;
}

function viewerAssets(options: HtmlExportOptions): Promise<HtmlExportAssets> {
  if (options.assets) return Promise.resolve(options.assets);
  assets ??= readFile(resolve('build/portable.json'), 'utf8')
    .then((text) => JSON.parse(text) as HtmlExportAssets)
    .catch((error) => {
      assets = undefined;
      throw error;
    });
  return assets;
}

function uniqueIds(root: string, include: string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [root, ...include]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function snapshotById(snapshots: ProjectSnapshot[]): Map<string, ProjectSnapshot> {
  return new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
}

function initialLinkedState(
  root: ProjectSnapshot,
  byId: Map<string, ProjectSnapshot>,
  includedIds: string[],
  options: HtmlExportOptions
): CompositionState {
  if (options.compositionState && options.composition)
    throw new Error('composition and compositionState are mutually exclusive');
  if (options.compositionState) return options.compositionState;
  if (options.composition)
    return stateFromComposition(root, options.composition, (id) => byId.get(id));
  const scene = options.scene ?? root.model.scenes[0]?.id;
  let state = rootState(root, {
    scene,
    theme: options.state.theme,
    layout: options.state.layout
  });
  for (const id of includedIds) {
    if (id === root.id) continue;
    const snapshot = byId.get(id);
    if (!snapshot) throw new Error(`Included project ${id} has no snapshot`);
    state = openProject(state, snapshot);
  }
  return state;
}

/**
 * Build the linked portable document and its scope report. Callers write the HTML and print
 * the report; a scene is not a publication filter.
 */
export async function exportLinkedDocument(
  model: Model,
  options: HtmlExportOptions
): Promise<{ document: PortableLinkedDocument; html: string; report: LinkedHtmlReport }> {
  if (options.include === undefined)
    throw new Error('Linked HTML export requires an explicit include set');
  const loaded = options.snapshots ?? [];
  const includedIds = uniqueIds(model.id, options.include);
  const byId = snapshotById(loaded);
  const missing = includedIds.filter((id) => !byId.has(id));
  if (missing.length)
    throw new Error(
      `Linked HTML export is missing snapshots for: ${missing.join(', ')}. Pass snapshots for the root and every --include id.`
    );
  const ordered = includedIds.map((id) => byId.get(id)!);
  const portable = linkedSnapshots(
    ordered.map((snapshot) => ({
      ...snapshot,
      sequences:
        options.sequencesByModel?.[snapshot.id] ??
        (snapshot.id === model.id ? options.sequences : undefined) ??
        []
    }))
  );
  const composition = initialLinkedState(ordered[0], byId, includedIds, options);
  const resolver = staticResolver(snapshotsForResolver(portable));
  const composed = await compose(resolver, composition);
  const excluded = collectExcludedLinks(portable);
  const document: PortableLinkedDocument = {
    version: 1,
    linkedContract: LINKED_CONTRACT_VERSION,
    snapshots: portable,
    revisions: {
      version: 1,
      projects: portable.map((snapshot) => ({ model: snapshot.id, revision: snapshot.revision }))
    },
    excluded,
    composition,
    composed,
    readOnly: true
  };
  const viewer = await viewerAssets(options);
  if (viewer.notices) document.licenses = viewer.notices;
  const html = linkedPortableHtml(document, viewer);
  const report: LinkedHtmlReport = {
    format: 'html',
    ...linkedHtmlReport(document)
  };
  return { document, html, report };
}

export async function exportHtml(model: Model, options: HtmlExportOptions): Promise<string> {
  if (options.include !== undefined) {
    const { html } = await exportLinkedDocument(model, options);
    return html;
  }
  const scene = options.scene ?? model.scenes[0]?.id;
  if (!scene || !model.scenes.some((item) => item.id === scene))
    throw new Error(`Unknown scene: ${scene}`);
  const diagram = await (options.diagram ?? (() => layout(model, options.state)))();
  const viewer = await viewerAssets(options);
  return portableHtml(
    {
      version: 1,
      model,
      sequences: options.sequences ?? [],
      scene,
      view: options.state,
      diagram,
      licenses: viewer.notices
    },
    viewer
  );
}

export type { LinkedHtmlReport, PortableLinkedSnapshot };
