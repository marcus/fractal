import { resolve } from 'node:path';

/**
 * The directory the user ran the command from. `bin/fractal` changes into the checkout so the
 * bundled examples, fonts and sources resolve, and hands the original directory over in
 * `FRACTAL_CALLER_CWD`; `npm run cli` runs from wherever npm was started, so it needs no hand-off.
 */
export function callerCwd(env: NodeJS.ProcessEnv = process.env): string {
  return env.FRACTAL_CALLER_CWD ? resolve(env.FRACTAL_CALLER_CWD) : process.cwd();
}

/** Resolve a user-supplied path against the caller's directory (absolute paths are unchanged). */
export function fromCaller(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolve(callerCwd(env), path);
}

/**
 * Re-anchor relative path-valued environment variables to the caller's directory, so
 * `FRACTAL_CATALOG=catalog.json bin/fractal ...` means the same file `--catalog catalog.json` does.
 */
export function anchorPathEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of [
    'FRACTAL_CATALOG',
    'FRACTAL_MODELS_DIR',
    'FRACTAL_CHROMIUM_PATH',
    'XDG_CONFIG_HOME'
  ]) {
    const value = env[name];
    if (value && !value.startsWith('~')) env[name] = fromCaller(value, env);
  }
}
