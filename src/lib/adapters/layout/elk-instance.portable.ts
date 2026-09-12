import ELK from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker&inline';
import type { ElkLayout } from './elk';

let shared: ElkLayout | undefined;

/**
 * ELK in a dedicated worker, for the portable document only, so arranging a new view never blocks
 * the reader's main thread. The document is a single file with no network, so elkjs's worker
 * script is inlined at build time and started from a blob URL: that works from `file://` and from
 * any nested HTTP path, and issues no request. Only elkjs's thin API runs on the main thread, so
 * the document still carries exactly one copy of ELK.
 *
 * `scripts/portable-assets.ts` substitutes this module for `elk-instance.ts` when it builds the
 * reader. Everything else about the engine — options, graph, geometry — is unchanged.
 */
export function elkInstance(): ElkLayout {
  if (shared) return shared;
  if (typeof Worker === 'undefined')
    throw new Error(
      'This browser cannot run web workers, which this document needs to arrange a new view. Open it in a current browser.'
    );
  shared = new ELK({ workerFactory: () => new ElkWorker() });
  return shared;
}

// Start the worker while the reader is still looking at the published view, so the first toggle
// pays for none of ELK's start-up. A browser without workers is reported by the first layout,
// through the viewer's error path, rather than by failing to load the document.
if (typeof Worker !== 'undefined') elkInstance();
