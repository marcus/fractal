export interface CatalogEntry {
  id: string;
  directory: string;
}

export interface ProjectCatalog {
  version: 1;
  projects: CatalogEntry[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

export function parseCatalog(input: unknown): ProjectCatalog {
  const catalog = record(input, 'catalog');
  if (catalog.version !== 1) throw new Error('catalog.version must be 1');
  if (!Array.isArray(catalog.projects)) throw new Error('catalog.projects must be an array');

  const projects = catalog.projects.map((value, index) => {
    const path = `catalog.projects[${index}]`;
    const project = record(value, path);
    if (typeof project.id !== 'string' || !slugPattern.test(project.id))
      throw new Error(`${path}.id must be a lowercase slug`);
    if (
      typeof project.directory !== 'string' ||
      !project.directory.startsWith('/') ||
      project.directory.trim() !== project.directory ||
      project.directory.includes('\0')
    )
      throw new Error(`${path}.directory must be a clean absolute path`);
    return { id: project.id, directory: project.directory };
  });

  const ids = new Set<string>();
  for (const project of projects) {
    if (ids.has(project.id))
      throw new Error(`catalog.projects contains duplicate ID: ${project.id}`);
    ids.add(project.id);
  }
  return { version: 1, projects };
}

export function searchProjects<T extends ProjectSummary>(
  projects: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...projects];
  return projects.filter((project) =>
    [project.id, project.title, project.description].some((value) =>
      value.toLocaleLowerCase().includes(needle)
    )
  );
}
