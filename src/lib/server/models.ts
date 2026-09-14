import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseModelWithOrigins } from '../adapters/likec4';
import { parseSequences } from '../sequence/parse';
import { parseCatalog, type CatalogEntry, type ProjectSummary } from '../core/catalog';
import type { Model } from '../core/types';
import { estimateBytes, type CompositionLimits } from '../composition/limits';
import { CompositionContractError, parseLinks } from '../composition/parse';
import type { ProjectSnapshot, SnapshotResolver } from '../composition/snapshot';
import type { IdentityOrigins, ProjectLinks } from '../composition/types';
import { createCache, serverCachePool, type CacheSnapshot } from './cache';

export interface CatalogOptions {
  catalog?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  /**
   * Admission-limit overrides for linked composition. Only service configuration may set
   * this; untrusted input (URLs, saved state, HTTP bodies) can never raise a limit.
   */
  limits?: CompositionLimits;
}

export interface ResolvedCatalog {
  kind: 'catalog' | 'models-directory' | 'bundled-examples';
  path: string;
  projects: CatalogEntry[];
}

export interface CatalogProject extends ProjectSummary {
  directory: string;
  /** Present when the entry cannot be listed as a healthy project; the picker shows it anyway. */
  diagnostic?: string;
}

/** A picker summary; `listModels` drops only the directory. */
export type CatalogModel = Omit<CatalogProject, 'directory'>;

export interface CatalogValidation {
  kind: ResolvedCatalog['kind'];
  path: string;
  projects: { id: string; directory: string; error?: string }[];
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

/**
 * Parse the catalog file only. Broken JSON, a bad schema and duplicate IDs stay fatal; entries are
 * returned untouched so a caller can validate the one directory it actually needs.
 */
async function readCatalog(path: string): Promise<CatalogEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read catalog ${path}: ${(error as Error).message}`);
  }
  return parseCatalog(parsed).projects;
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

/**
 * Validate one catalog entry without compiling its model: the directory exists, `fractal.json` is
 * readable and — for an explicit catalog — names the catalog ID, and `model.c4` is present. A
 * missing directory is reported with its own prefix so a resolver can call it unavailable rather
 * than invalid; every other failure keeps the message the old whole-catalog validation produced.
 */
async function validateEntry(catalog: ResolvedCatalog, entry: CatalogEntry): Promise<void> {
  const info = await stat(entry.directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`Model directory missing: ${entry.directory}`);
    throw new Error(
      `Catalog ${catalog.path} project ${entry.id} (${entry.directory}) is invalid: ${error.message}`
    );
  });
  if (!info.isDirectory()) throw new Error(`Model directory missing: ${entry.directory}`);
  try {
    const [companion] = await Promise.all([
      readFile(join(entry.directory, 'fractal.json'), 'utf8'),
      access(join(entry.directory, 'model.c4'))
    ]);
    // The companion owns the model identity in every catalog kind: a directory name
    // must never select an identity, so a mismatch is invalid everywhere, not only in
    // explicit catalogs.
    const metadata = JSON.parse(companion) as { id?: unknown };
    if (metadata.id !== entry.id)
      throw new Error(
        `catalog ID ${entry.id} does not match companion model ID ${String(metadata.id)}`
      );
  } catch (error) {
    throw new Error(
      `Catalog ${catalog.path} project ${entry.id} (${entry.directory}) is invalid: ${(error as Error).message}`
    );
  }
}

/** Find and validate exactly one catalog entry. The model itself is loaded by the caller. */
export async function resolveProject(
  id: string,
  options: CatalogOptions = {}
): Promise<{ catalog: ResolvedCatalog; entry: CatalogEntry }> {
  const catalog = await resolveCatalog(options);
  const entry = catalog.projects.find((project) => project.id === id);
  if (!entry) throw new Error(`Unknown model: ${id}`);
  await validateEntry(catalog, entry);
  return { catalog, entry };
}

/** Validate every entry the old catalog-wide way, reporting each failure instead of throwing. */
export async function validateCatalog(options: CatalogOptions = {}): Promise<CatalogValidation> {
  const catalog = await resolveCatalog(options);
  const projects = await Promise.all(
    catalog.projects.map(async (entry) => {
      try {
        await validateEntry(catalog, entry);
        return { id: entry.id, directory: entry.directory };
      } catch (error) {
        return { id: entry.id, directory: entry.directory, error: (error as Error).message };
      }
    })
  );
  return { kind: catalog.kind, path: catalog.path, projects };
}

async function optionalSource(directory: string, name: string): Promise<string | null> {
  try {
    return await readFile(join(directory, name), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function parseDirectory(directory: string) {
  const [source, companion, sequenceSource, linksSource] = await Promise.all([
    readFile(join(directory, 'model.c4'), 'utf8'),
    readFile(join(directory, 'fractal.json'), 'utf8'),
    optionalSource(directory, 'sequences.json'),
    optionalSource(directory, 'links.json')
  ]);
  const { model, origins } = await parseModelWithOrigins(source, JSON.parse(companion));
  const sequences =
    sequenceSource === null ? [] : parseSequences(JSON.parse(sequenceSource), model);
  // A malformed links.json fails this directory exactly like a malformed fractal.json does.
  const links = linksSource === null ? null : parseLinks(JSON.parse(linksSource), model.id);
  const hash = createHash('sha256').update(source).update('\0').update(companion);
  if (sequenceSource !== null) hash.update('\0sequences\0').update(sequenceSource);
  if (linksSource !== null) hash.update('\0links\0').update(linksSource);
  return { model, sequences, source, sequenceSource, links, origins, revision: hash.digest('hex') };
}

/**
 * The files a parsed model is made of. `sequences.json` and `links.json` are optional; their
 * absence is part of the stamp.
 */
const MODEL_FILES = ['model.c4', 'fractal.json', 'sequences.json', 'links.json'] as const;
const MODEL_CACHE_LIMIT = 64;
/**
 * Parsed models, bounded by entries and estimated bytes. A stored promise carries a nominal
 * in-flight estimate until it settles, when the snapshot's serialized size replaces it; the
 * pool evicts composed results and layouts before these parses. Entries are tagged with
 * their directory and model ID so one project's edit invalidates exactly its dependents.
 */
const parsedModels = createCache<ReturnType<typeof parseDirectory>>(MODEL_CACHE_LIMIT, {
  maxBytes: 64 * 1024 * 1024,
  settleSizeOf: (parsed) => estimateBytes(snapshotOf(parsed)),
  inFlightBytes: 64 * 1024,
  pool: serverCachePool,
  priority: 2
});

/**
 * Invalidation aids, not cached content: the last model ID and every stamp parsed from
 * each directory. A stamp never seen for a known directory means the source changed, and
 * only then are dependents dropped — a first sight (or a second directory holding an
 * identical copy) invalidates nothing, so entries that are still valid are never evicted.
 * These survive `clearModelCache` on purpose: forgetting them would serve stale layouts
 * after an edit followed by a model-cache clear.
 */
const directoryModels = new Map<string, string>();
const directoryStamps = new Map<string, Set<string>>();

/**
 * Drop every parsed model, layout and composed result tagged with this project. Returns the
 * entries removed. Editing one target's source calls this (through the fresh-parse path
 * below) so unrelated projects' layout entries survive.
 */
export function invalidateProject(model: string, directory?: string): number {
  const tags = directory === undefined || directory === model ? [model] : [model, directory];
  return serverCachePool.invalidateTags(tags);
}

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
 * Only successful parses are cached: an invalid model is read and fails on every call rather than
 * remembering that it once failed. The parse in flight is what is stored, so a caller racing the
 * first reader compiles the model once.
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
  // Stored untagged until the parse settles: the invalidation below must not remove the entry
  // it just created, while every older entry for this directory is already tagged.
  parsedModels.set(key, pending);
  try {
    const parsed = await pending;
    // A stamp never seen for a known directory means the source changed: drop this
    // project's stale parses, layouts and composed results, while unrelated projects
    // survive. A first sight invalidates nothing.
    const seen = directoryStamps.get(directory);
    if (seen !== undefined && !seen.has(stamp)) {
      invalidateProject(parsed.model.id, directory);
      const previous = directoryModels.get(directory);
      if (previous !== undefined && previous !== parsed.model.id)
        serverCachePool.invalidateTags([previous]);
    }
    if (seen) seen.add(stamp);
    else directoryStamps.set(directory, new Set([stamp]));
    directoryModels.set(directory, parsed.model.id);
    parsedModels.tag(key, [directory, parsed.model.id]);
    return parsed;
  } catch (error) {
    parsedModels.delete(key);
    throw error;
  }
}

/** Forget every parsed model. Tests use this to start from a cold cache. */
export function clearModelCache(): void {
  parsedModels.clear();
}

/**
 * A reload that collided with a concurrent write: the directory stamps taken before and
 * after the read disagree, even after one retry. The load did not complete and retrying is
 * safe; the caller reports `source_changing` with recovery `retry` instead of mixing states.
 */
export class SourceChangingError extends Error {
  readonly code = 'source_changing';
  readonly recovery = 'retry';
  readonly directory: string;
  constructor(directory: string) {
    super(`Model source ${directory} is changing on disk. Retry the load.`);
    this.name = 'SourceChangingError';
    this.directory = directory;
  }
}

type ParsedDirectory = Awaited<ReturnType<typeof parseDirectory>>;

/**
 * Reload one model directory with stamp verification: the stamps taken before and after the
 * read must agree, or the read raced a concurrent write. A mismatch retries once from a
 * fresh stamp; a second mismatch throws `SourceChangingError` instead of returning a model
 * mixed from two states. The read always parses fresh — the stamp cache is only written,
 * never trusted — so a reload observes the latest committed write.
 */
export async function reloadDirectory(
  directory: string,
  io: {
    stamp?: () => Promise<string>;
    read?: () => Promise<ParsedDirectory>;
  } = {}
): Promise<ParsedDirectory> {
  const stamp = io.stamp ?? (() => directoryStamp(directory));
  const read = io.read ?? (() => parseDirectory(directory));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await stamp();
    const parsed = await read();
    const after = await stamp();
    if (before === after) {
      // Invalidate before storing: the new entry is tagged, so the reverse order would
      // remove it as well. A reload observes the latest committed write, never the cache.
      if (typeof parsed.model?.id === 'string') {
        invalidateProject(parsed.model.id, directory);
        const previous = directoryModels.get(directory);
        if (previous !== undefined && previous !== parsed.model.id)
          serverCachePool.invalidateTags([previous]);
        directoryModels.set(directory, parsed.model.id);
        const seen = directoryStamps.get(directory);
        if (seen) seen.add(after);
        else directoryStamps.set(directory, new Set([after]));
        parsedModels.set(`${directory}\0${after}`, Promise.resolve(parsed), {
          tags: [directory, parsed.model.id]
        });
      } else {
        parsedModels.set(`${directory}\0${after}`, Promise.resolve(parsed));
      }
      return parsed;
    }
  }
  throw new SourceChangingError(directory);
}

/** Parses skipped and performed, entries, estimated bytes and evictions. A test seam and metric. */
export function modelCacheStats(): CacheSnapshot {
  return parsedModels.snapshot();
}
/**
 * A snapshot for the composition core: the parsed model, its optional authored links, the
 * explicit/fallback origin of every local ID, and the content revision.
 */
export function snapshotOf(loaded: {
  model: Model;
  links: ProjectLinks | null;
  origins: IdentityOrigins;
  revision: string;
}): ProjectSnapshot {
  return {
    id: loaded.model.id,
    model: loaded.model,
    links: loaded.links,
    origins: loaded.origins,
    revision: loaded.revision
  };
}

const catalogSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A resolver over the configured catalog. It maps a model ID to a snapshot without compiling the
 * whole catalog, and turns expected failures into typed resolution outcomes instead of throwing.
 */
export function catalogResolver(options: CatalogOptions = {}): SnapshotResolver {
  return {
    async resolve(model) {
      if (!catalogSlug.test(model))
        return {
          status: 'unavailable',
          code: 'model_unavailable',
          message: `Model ${model} is not a valid catalog identifier.`
        };
      let entry: CatalogEntry;
      try {
        entry = (await resolveProject(model, options)).entry;
      } catch (error) {
        const message = (error as Error).message;
        if (message.startsWith('Unknown model:') || message.startsWith('Model directory missing:'))
          return { status: 'unavailable', code: 'model_unavailable', message };
        return { status: 'invalid', code: 'model_invalid', message };
      }
      try {
        const snapshot = snapshotOf(await loadDirectory(entry.directory));
        // Identity is the companion's, never the directory's: a models-directory entry
        // whose companion names another model is invalid, not a model by that name.
        if (snapshot.id !== model)
          return {
            status: 'invalid',
            code: 'model_invalid',
            message: `Catalog project ${model} does not match companion model ID ${snapshot.id}`
          };
        return { status: 'resolved', snapshot };
      } catch (error) {
        if (error instanceof CompositionContractError && error.code === 'unsupported_version')
          return { status: 'invalid', code: 'unsupported_version', message: error.message };
        return { status: 'invalid', code: 'model_invalid', message: (error as Error).message };
      }
    }
  };
}

/**
 * A resolver over the configured catalog that reloads every entry: each snapshot is parsed
 * fresh with stamp verification (one retry, then `SourceChangingError`) instead of trusting
 * the stamp cache. Explicit reloads — not ordinary renders — use this, so steady-state reads
 * stay cheap while a reload observes the latest committed write.
 */
export function catalogReloader(options: CatalogOptions = {}): SnapshotResolver {
  return {
    async resolve(model) {
      if (!catalogSlug.test(model))
        return {
          status: 'unavailable',
          code: 'model_unavailable',
          message: `Model ${model} is not a valid catalog identifier.`
        };
      let entry: CatalogEntry;
      try {
        entry = (await resolveProject(model, options)).entry;
      } catch (error) {
        const message = (error as Error).message;
        if (message.startsWith('Unknown model:') || message.startsWith('Model directory missing:'))
          return { status: 'unavailable', code: 'model_unavailable', message };
        return { status: 'invalid', code: 'model_invalid', message };
      }
      const snapshot = snapshotOf(await reloadDirectory(entry.directory));
      if (snapshot.id !== model)
        return {
          status: 'invalid',
          code: 'model_invalid',
          message: `Catalog project ${model} does not match companion model ID ${snapshot.id}`
        };
      return { status: 'resolved', snapshot };
    }
  };
}

export async function loadModel(id: string, options: CatalogOptions = {}) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid model identifier');
  const { entry } = await resolveProject(id, options);
  const loaded = await loadDirectory(entry.directory);
  if (loaded.model.id !== id)
    throw new Error(`Catalog project ${id} does not match companion model ID ${loaded.model.id}`);
  return loaded;
}

/**
 * Lightweight picker summaries: read companion metadata only, never compile a model. A broken
 * entry keeps its ID as a title and carries a diagnostic instead of taking the list down.
 */
/** A picker row for an entry that cannot be listed as a healthy project. */
function unhealthyProject(entry: CatalogEntry, diagnostic: string): CatalogProject {
  return {
    id: entry.id,
    title: entry.id,
    description: '',
    directory: entry.directory,
    diagnostic
  };
}

async function projectSummary(
  catalog: ResolvedCatalog,
  entry: CatalogEntry
): Promise<CatalogProject> {
  try {
    if (!(await stat(entry.directory)).isDirectory())
      return unhealthyProject(entry, `Model directory missing: ${entry.directory}`);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    // Only a directory that cannot be stat'd is missing; a missing companion is an invalid entry.
    if (failure.code === 'ENOENT')
      return unhealthyProject(entry, `Model directory missing: ${entry.directory}`);
    return unhealthyProject(
      entry,
      `Catalog ${catalog.path} project ${entry.id} (${entry.directory}) is invalid: ${failure.message}`
    );
  }
  try {
    const companion = JSON.parse(await readFile(join(entry.directory, 'fractal.json'), 'utf8')) as {
      id?: unknown;
      title?: unknown;
      description?: unknown;
    };
    // Like validateEntry: the companion owns the identity in every catalog kind.
    if (companion.id !== entry.id)
      throw new Error(
        `catalog ID ${entry.id} does not match companion model ID ${String(companion.id)}`
      );
    if (typeof companion.title !== 'string' || !companion.title.trim())
      throw new Error('companion.title must be a non-empty string');
    if (typeof companion.description !== 'string')
      throw new Error('companion.description must be a string');
    return {
      id: entry.id,
      title: companion.title,
      description: companion.description,
      directory: entry.directory
    };
  } catch (error) {
    return unhealthyProject(
      entry,
      `Catalog ${catalog.path} project ${entry.id} (${entry.directory}) is invalid: ${(error as Error).message}`
    );
  }
}

export async function listProjects(options: CatalogOptions = {}): Promise<CatalogProject[]> {
  const catalog = await resolveCatalog(options);
  const projects = await Promise.all(
    catalog.projects.map((entry) => projectSummary(catalog, entry))
  );
  return projects.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export async function listModels(options: CatalogOptions = {}): Promise<CatalogModel[]> {
  return (await listProjects(options)).map(({ id, title, description, diagnostic }) => ({
    id,
    title,
    description,
    ...(diagnostic ? { diagnostic } : {})
  }));
}
