import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkLayout } from './elk';

let shared: ElkLayout | undefined;

/**
 * The ELK the registered engines place with unless a caller supplies its own: the bundled
 * main-thread build, shared across calls because constructing one costs a few milliseconds. The
 * CLI, the server, the benchmark and the tests all take this path.
 *
 * The portable document's build (`scripts/portable-assets.ts`) substitutes
 * `elk-instance.portable.ts`, which runs the same ELK in a worker so a toggle never blocks the
 * reader's main thread. Only the instance differs; the engine, its options and its geometry do not.
 */
export function elkInstance(): ElkLayout {
  return (shared ??= new ELK());
}
