import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseModel } from '../adapters/likec4';
import { parseSequences } from '../sequence/parse';
import { parseCatalog, type CatalogEntry, type ProjectSummary } from '../core/catalog';

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

export async function loadDirectory(directory: string) {
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
