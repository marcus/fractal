import type { Diagram, Model, ViewState } from '../core/types';
import type { SequenceJourney } from '../sequence/types';

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

/** Script data is text even when authored descriptions contain HTML or closing tags. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

export function portableHtml(
  document: PortableDocument,
  assets: { js: string; css: string }
): string {
  const title = document.model.title.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Fractal"><title>${title} · Fractal</title><style>${assets.css.replace(/<\/style/gi, '<\\/style')}</style></head>
<body><div id="fractal-reader"></div><noscript>This interactive Fractal document requires JavaScript.</noscript>
<script type="application/json" id="fractal-document">${scriptJson(document)}</script>
<script>${assets.js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
