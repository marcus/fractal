import type { Diagram, Model, ViewState } from '../core/types';
import type { SequenceJourney } from '../sequence/types';
import type { ProjectSnapshot } from '../composition/snapshot';
import type {
  ComposedDiagram,
  CompositionState,
  IdentityOrigins,
  ProjectLinks
} from '../composition/types';

/** A snapshot, without catalog, source directory, service or author-machine metadata. */
export interface PortableDocument {
  version: 1;
  licenses?: string;
  model: Model;
  sequences: SequenceJourney[];
  scene: string;
  view: ViewState;
  diagram: Diagram;
}

/** Linked-project contract this reader advertises and this exporter writes. */
export const LINKED_CONTRACT_VERSION = 1 as const;

/** One included project, frozen at export: full model, scenes, evidence, links and origins. */
export interface PortableLinkedSnapshot {
  id: string;
  model: Model;
  sequences: SequenceJourney[];
  links: ProjectLinks | null;
  origins: IdentityOrigins;
  revision: string;
}

export interface PortableExcludedLink {
  owner: string;
  linkId: string;
  title: string;
  target: { model: string; scene?: string };
  reason: 'excluded';
}

/** Versioned revision vector for the explicit included set. */
export interface PortableRevisionManifest {
  version: 1;
  projects: { model: string; revision: string }[];
}

/**
 * A linked portable document. It has no top-level `model`/`diagram`, so an older reader that
 * only understands a single-project snapshot cannot present the root as a complete composition.
 */
export interface PortableLinkedDocument {
  version: 1;
  linkedContract: typeof LINKED_CONTRACT_VERSION;
  licenses?: string;
  snapshots: PortableLinkedSnapshot[];
  revisions: PortableRevisionManifest;
  excluded: PortableExcludedLink[];
  composition: CompositionState;
  composed: ComposedDiagram;
  readOnly: true;
}

export type AnyPortableDocument = PortableDocument | PortableLinkedDocument;

export function isLinkedDocument(value: AnyPortableDocument): value is PortableLinkedDocument {
  return 'linkedContract' in value && value.linkedContract !== undefined;
}

export interface LinkedHtmlReport {
  format: 'html';
  model: string;
  scene?: string;
  linkedContract: typeof LINKED_CONTRACT_VERSION;
  included: { model: string; revision: string; title: string }[];
  excluded: PortableExcludedLink[];
  revisions: PortableRevisionManifest;
}

/** Script data is text even when authored descriptions contain HTML or closing tags. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

function escapeTitle(title: string): string {
  return title.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );
}

function wrapHtml(
  title: string,
  document: unknown,
  assets: { js: string; css: string },
  extras = ''
): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Fractal">${extras}<title>${title} · Fractal</title><style>${assets.css.replace(/<\/style/gi, '<\\/style')}</style></head>
<body><div id="fractal-reader"></div><noscript>This interactive Fractal document requires JavaScript.</noscript>
<script type="application/json" id="fractal-document">${scriptJson(document)}</script>
<script>${assets.js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

export function portableHtml(
  document: PortableDocument,
  assets: { js: string; css: string }
): string {
  return wrapHtml(escapeTitle(document.model.title), document, assets);
}

export function linkedPortableHtml(
  document: PortableLinkedDocument,
  assets: { js: string; css: string }
): string {
  const root = document.snapshots[0];
  const extras = `<meta name="fractal-linked-contract" content="${document.linkedContract}">`;
  const html = wrapHtml(escapeTitle(root?.model.title ?? 'Fractal'), document, assets, extras);
  // A status node sits in the body so an older reader that throws on the missing top-level
  // model still leaves an honest message instead of an empty page that looks complete.
  return html.replace(
    '<div id="fractal-reader"></div>',
    `<div id="fractal-reader"></div><p id="fractal-linked-required">This document includes linked projects and requires a reader that supports linked-project contract v${document.linkedContract}. It is a snapshot and does not update when repositories change.</p>`
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Links from included projects whose targets are not in the explicit included set. */
export function collectExcludedLinks(
  snapshots: Iterable<Pick<PortableLinkedSnapshot, 'id' | 'links'>>
): PortableExcludedLink[] {
  const included = new Set([...snapshots].map((snapshot) => snapshot.id));
  const excluded: PortableExcludedLink[] = [];
  for (const snapshot of snapshots) {
    for (const link of snapshot.links?.links ?? []) {
      if (included.has(link.target.model)) continue;
      excluded.push({
        owner: snapshot.id,
        linkId: link.id,
        title: link.title,
        target: {
          model: link.target.model,
          ...(link.target.scene === undefined ? {} : { scene: link.target.scene })
        },
        reason: 'excluded'
      });
    }
  }
  excluded.sort(
    (a, b) =>
      compare(a.owner, b.owner) ||
      compare(a.linkId, b.linkId) ||
      compare(a.target.model, b.target.model)
  );
  return excluded;
}

export function linkedSnapshots(
  loaded: Iterable<{
    model: Model;
    sequences?: SequenceJourney[];
    links: ProjectLinks | null;
    origins: IdentityOrigins;
    revision: string;
  }>
): PortableLinkedSnapshot[] {
  return [...loaded].map((entry) => ({
    id: entry.model.id,
    model: entry.model,
    sequences: entry.sequences ?? [],
    links: entry.links,
    origins: entry.origins,
    revision: entry.revision
  }));
}

export function snapshotsForResolver(snapshots: PortableLinkedSnapshot[]): ProjectSnapshot[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    model: snapshot.model,
    links: snapshot.links,
    origins: snapshot.origins,
    revision: snapshot.revision
  }));
}

export function linkedHtmlReport(
  document: PortableLinkedDocument
): Omit<LinkedHtmlReport, 'format'> {
  return {
    model: document.composition.root,
    scene: document.composition.projects[0]?.scene,
    linkedContract: document.linkedContract,
    included: document.snapshots.map((snapshot) => ({
      model: snapshot.id,
      revision: snapshot.revision,
      title: snapshot.model.title
    })),
    excluded: document.excluded,
    revisions: document.revisions
  };
}
