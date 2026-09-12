import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseModel } from '../adapters/likec4';
import { parseSequences } from '../sequence/parse';
import { parseCatalog, type CatalogEntry, type ProjectSummary } from '../core/catalog';
import { createCache } from './cache';

export interface CatalogOptions {
  catalog?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
}

export interface ResolvedCatalog {
  kind: 'catalog' | 'models-directory' | 'bundled-examples';
  path: string;
  projects: CatalogEntry[];
}

export interface CatalogProject extends ProjectSummary {
  directory: string;
}

function expandPath(path: string, options: CatalogOptions): string {
  const home = options.home ?? homedir();
  const expanded = path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path;
  return resolve(options.cwd ?? process.cwd(), expanded);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function projectsInRoot(root: string): Promise<CatalogEntry[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ id: entry.name, directory: join(root, entry.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function readCatalog(path: string): Promise<CatalogEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read catalog ${path}: ${(error as Error).message}`);
  }
  const catalog = parseCatalog(parsed);
  await Promise.all(
    catalog.projects.map(async (project) => {
      try {
        if (!(await stat(project.directory)).isDirectory())
          throw new Error(`${project.directory} is not a directory`);
        const [companion] = await Promise.all([
          readFile(join(project.directory, 'fractal.json'), 'utf8'),
          access(join(project.directory, 'model.c4'))
        ]);
        const metadata = JSON.parse(companion) as { id?: unknown };
        if (metadata.id !== project.id)
          throw new Error(
            `catalog ID ${project.id} does not match companion model ID ${String(metadata.id)}`
          );
      } catch (error) {
        throw new Error(
          `Catalog ${path} project ${project.id} (${project.directory}) is invalid: ${(error as Error).message}`
        );
      }
    })
  );
  return catalog.projects;
}

export async function resolveCatalog(options: CatalogOptions = {}): Promise<ResolvedCatalog> {
  const env = options.env ?? process.env;
  const explicitCatalog =
    options.catalog !== undefined ? options.catalog : env.FRACTAL_CATALOG || undefined;
  if (explicitCatalog !== undefined) {
    const path = expandPath(explicitCatalog, options);
    return { kind: 'catalog', path, projects: await readCatalog(path) };
  }
  if (env.FRACTAL_MODELS_DIR) {
    const path = expandPath(env.FRACTAL_MODELS_DIR, options);
    return { kind: 'models-directory', path, projects: await projectsInRoot(path) };
  }
  const configRoot = env.XDG_CONFIG_HOME
    ? expandPath(env.XDG_CONFIG_HOME, options)
    : join(options.home ?? homedir(), '.config');
  const defaultCatalog = join(configRoot, 'fractal', 'catalog.json');
  if (await exists(defaultCatalog))
    return { kind: 'catalog', path: defaultCatalog, projects: await readCatalog(defaultCatalog) };

  const path = resolve(options.cwd ?? process.cwd(), 'examples');
  return { kind: 'bundled-examples', path, projects: await projectsInRoot(path) };
}

async function optionalSequenceSource(directory: string): Promise<string | null> {
  try {
    return await readFile(join(directory, 'sequences.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function parseDirectory(directory: string) {
  const [source, companion, sequenceSource] = await Promise.all([
    readFile(join(directory, 'model.c4'), 'utf8'),
    readFile(join(directory, 'fractal.json'), 'utf8'),
    optionalSequenceSource(directory)
  ]);
  const model = await parseModel(source, JSON.parse(companion));
  const sequences =
    sequenceSource === null ? [] : parseSequences(JSON.parse(sequenceSource), model);
  const hash = createHash('sha256').update(source).update('\0').update(companion);
  if (sequenceSource !== null) hash.update('\0sequences\0').update(sequenceSource);
  return { model, sequences, source, sequenceSource, revision: hash.digest('hex') };
}

/** The files a parsed model is made of. `sequences.json` is optional; its absence is part of the stamp. */
const MODEL_FILES = ['model.c4', 'fractal.json', 'sequences.json'] as const;
const MODEL_CACHE_LIMIT = 64;
const parsedModels = createCache<ReturnType<typeof parseDirectory>>(MODEL_CACHE_LIMIT);

/**
 * Size and modification time of every file a model is parsed from. Any change — an edit, a
 * rewrite of the same length, an added or removed `sequences.json` — produces a different stamp,
 * so the cache key changes and the model is parsed again. The content hash in `revision` remains
 * the authority on what a reader is looking at.
 */
async function directoryStamp(directory: string): Promise<string> {
  const stamps = await Promise.all(
    MODEL_FILES.map(async (name) => {
      try {
        const info = await stat(join(directory, name), { bigint: true });
        return `${name}:${info.size}:${info.mtimeNs}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return `${name}:absent`;
        throw error;
      }
    })
  );
  return stamps.join('\0');
}

/**
 * Parse a model directory, reusing the previous parse while its files are untouched.
 *
 * Only successful parses are cached: an invalid model is read and fails on every call, so the
 * project list keeps failing loudly rather than remembering that it once failed. The parse in
 * flight is what is stored, so the nine models of a project list — or a warm-up racing the first
 * reader — are each compiled once.
 */
export async function loadDirectory(directory: string) {
  // A stamp that cannot be taken (an unreadable directory) skips the cache entirely, so the
  // parse below reports the same error it always did.
  const stamp = await directoryStamp(directory).catch(() => null);
  if (stamp === null) return parseDirectory(directory);
  const key = `${directory}\0${stamp}`;
  const cached = parsedModels.get(key);
  if (cached) return cached;
  const pending = parseDirectory(directory);
  parsedModels.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    parsedModels.delete(key);
    throw error;
  }
}

/** Forget every parsed model. Tests use this to start from a cold cache. */
export function clearModelCache(): void {
  parsedModels.clear();
}

/** Parses skipped and parses performed since the last clear. A test seam, not a metric. */
export function modelCacheStats(): { hits: number; misses: number; size: number } {
  return { ...parsedModels.stats, size: parsedModels.size };
}
export async function loadModel(id: string, options: CatalogOptions = {}) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid model identifier');
  const catalog = await resolveCatalog(options);
  const entry = catalog.projects.find((project) => project.id === id);
  if (!entry) throw new Error(`Unknown model: ${id}`);
  const loaded = await loadDirectory(entry.directory);
  if (catalog.kind === 'catalog' && loaded.model.id !== id)
    throw new Error(`Catalog project ${id} does not match companion model ID ${loaded.model.id}`);
  return loaded;
}
export async function listProjects(options: CatalogOptions = {}): Promise<CatalogProject[]> {
  const catalog = await resolveCatalog(options);
  const projects = await Promise.all(
    catalog.projects.map(async (entry) => {
      const { model } = await loadDirectory(entry.directory);
      if (catalog.kind === 'catalog' && model.id !== entry.id)
        throw new Error(
          `Catalog project ${entry.id} does not match companion model ID ${model.id}`
        );
      return {
        id: entry.id,
        title: model.title,
        description: model.description,
        directory: entry.directory
      };
    })
  );
  return projects.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export async function listModels(options: CatalogOptions = {}): Promise<ProjectSummary[]> {
  return (await listProjects(options)).map(({ id, title, description }) => ({
    id,
    title,
    description
  }));
}
