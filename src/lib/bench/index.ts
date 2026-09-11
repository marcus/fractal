/**
 * Layout benchmark core: stage timing, a geometry fingerprint, composition quality metrics, a
 * synthetic model generator, and baseline comparison. Nothing here reads or writes files or
 * knows about a command line; `scripts/bench.ts` is the shell that does.
 */
export * from './baseline';
export * from './fingerprint';
export * from './quality';
export * from './synthetic';
export * from './timing';
export * from './types';
