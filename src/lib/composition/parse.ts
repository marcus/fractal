import type {
  CompositionDiagnostic,
  CompositionState,
  ElementReference,
  ProjectLinks,
  ProjectViewState,
  QualifiedSelection
} from './types';

/** A bounded file/state contract, independent of future runtime admission overrides. */
export const MAX_COMPOSITION_STATE_BYTES = 64 * 1024;
export class CompositionContractError extends Error {
  constructor(
    readonly path: string,
    detail: string,
    readonly code:
      'invalid_contract' | 'unsupported_version' | 'budget_exceeded' = 'invalid_contract'
  ) {
    super(`${path}: ${detail}`);
    this.name = 'CompositionContractError';
  }
}
type Obj = Record<string, unknown>;
function fail(path: string, detail: string): never {
  throw new CompositionContractError(path, detail);
}
function object(value: unknown, allowed: string[], path: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const result = value as Obj;
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) fail(`${path}[${JSON.stringify(key)}]`, 'unsupported field');
  }
  return result;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a nonempty string');
  return value;
}
function id(value: unknown, path: string): string {
  const result = text(value, path);
  if (result.trim() !== result || /[\u0000-\u001f\u007f]/.test(result))
    fail(path, 'must be a clean identity');
  return result;
}
function model(value: unknown, path: string): string {
  const result = id(value, path);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) fail(path, 'must be a lowercase catalog slug');
  return result;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    fail(path, `must be ${choices.join(' or ')}`);
  return value as T;
}
function optionalId(value: unknown, key: string, path: string): Record<string, string> {
  return value === undefined ? {} : { [key]: id(value, `${path}.${key}`) };
}
function version(value: unknown, path: string): void {
  if (value !== 1)
    throw new CompositionContractError(path, 'only version 1 is supported', 'unsupported_version');
}
function unique(values: string[], path: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) fail(`${path}[${index}]`, `duplicate identity ${value}`);
    seen.add(value);
  });
}
function endpoint(value: unknown, path: string): ElementReference {
  const input = object(value, ['model', 'element'], path);
  return {
    model: model(input.model, `${path}.model`),
    element: id(input.element, `${path}.element`)
  };
}

/** Validates authored structure and ownership; does not load models or validate UID existence/origin. */
export function parseLinks(value: unknown, ownerModel: string): ProjectLinks {
  model(ownerModel, 'ownerModel');
  const input = object(value, ['version', 'links', 'connections', 'compositions'], 'links');
  version(input.version, 'links.version');
  const links = list(input.links, 'links.links').map((value, index) => {
    const path = `links.links[${index}]`;
    const link = object(value, ['id', 'from', 'target', 'title'], path);
    const target = object(link.target, ['model', 'scene'], `${path}.target`);
    const targetModel = model(target.model, `${path}.target.model`);
    if (targetModel === ownerModel) fail(`${path}.target.model`, 'must name a foreign project');
    return {
      id: id(link.id, `${path}.id`),
      ...optionalId(link.from, 'from', path),
      target: { model: targetModel, ...optionalId(target.scene, 'scene', `${path}.target`) },
      title: text(link.title, `${path}.title`)
    };
  });
  unique(
    links.map((link) => link.id),
    'links.links'
  );
  const declared = new Set([ownerModel, ...links.map((link) => link.target.model)]);
  const connections = list(
    input.connections === undefined ? [] : input.connections,
    'links.connections'
  ).map((value, index) => {
    const path = `links.connections[${index}]`;
    const connection = object(
      value,
      ['id', 'source', 'target', 'title', 'kind', 'status', 'description', 'evidence'],
      path
    );
    const source = endpoint(connection.source, `${path}.source`);
    const target = endpoint(connection.target, `${path}.target`);
    if (source.model !== ownerModel && target.model !== ownerModel)
      fail(path, 'an endpoint must belong to the authoring project');
    if (source.model === target.model) fail(path, 'local relationships belong in the source model');
    for (const [name, ref] of [
      ['source', source],
      ['target', target]
    ] as const) {
      if (!declared.has(ref.model))
        fail(`${path}.${name}.model`, 'foreign project must be declared by a link');
    }
    const evidence = list(
      connection.evidence === undefined ? [] : connection.evidence,
      `${path}.evidence`
    ).map((value, index) => {
      const location = `${path}.evidence[${index}]`;
      const entry = id(value, location);
      if (
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.split('/').some((part) => part === '..') ||
        /^[a-z][a-z0-9+.-]*:/i.test(entry)
      )
        fail(location, 'must be a repository-relative evidence path');
      return entry;
    });
    if (connection.description !== undefined && typeof connection.description !== 'string')
      fail(`${path}.description`, 'must be a string');
    return {
      id: id(connection.id, `${path}.id`),
      source,
      target,
      title: text(connection.title, `${path}.title`),
      kind: text(connection.kind, `${path}.kind`),
      status: choice(
        connection.status === undefined ? 'current' : connection.status,
        ['current', 'proposed'],
        `${path}.status`
      ),
      description: (connection.description === undefined ? '' : connection.description) as string,
      evidence
    };
  });
  unique(
    connections.map((connection) => connection.id),
    'links.connections'
  );
  const compositions = list(
    input.compositions === undefined ? [] : input.compositions,
    'links.compositions'
  ).map((value, index) => {
    const path = `links.compositions[${index}]`;
    const composition = object(value, ['id', 'title', 'rootScene', 'projects'], path);
    const projects = list(composition.projects, `${path}.projects`).map((value, index) => {
      const location = `${path}.projects[${index}]`;
      const project = object(value, ['model', 'scene', 'mode'], location);
      const projectModel = model(project.model, `${location}.model`);
      if (projectModel === ownerModel || !declared.has(projectModel))
        fail(`${location}.model`, 'must be a declared foreign project; root is implicit');
      return {
        model: projectModel,
        ...optionalId(project.scene, 'scene', location),
        mode: choice(project.mode, ['open', 'collapsed'], `${location}.mode`)
      };
    });
    unique(
      projects.map((project) => project.model),
      `${path}.projects`
    );
    return {
      id: id(composition.id, `${path}.id`),
      title: text(composition.title, `${path}.title`),
      ...optionalId(composition.rootScene, 'rootScene', path),
      projects
    };
  });
  unique(
    compositions.map((composition) => composition.id),
    'links.compositions'
  );
  return { version: 1, links, connections, compositions };
}

function view(value: unknown, path: string): ProjectViewState {
  const input = object(value, ['expanded', 'proposed', 'lens', 'scope'], path);
  const expanded = list(input.expanded, `${path}.expanded`).map((value, index) =>
    id(value, `${path}.expanded[${index}]`)
  );
  unique(expanded, `${path}.expanded`);
  if (typeof input.proposed !== 'boolean') fail(`${path}.proposed`, 'must be a boolean');
  return {
    expanded,
    proposed: input.proposed,
    lens: choice(input.lens, ['structure', 'trust'], `${path}.lens`),
    ...optionalId(input.scope, 'scope', path)
  };
}
function selection(value: unknown, path: string): QualifiedSelection {
  const discriminator = object(
    value,
    ['kind', 'model', 'element', 'relationship', 'boundary', 'scene', 'ownerModel', 'connectionId'],
    path
  );
  const kind = choice(
    discriminator.kind,
    ['project', 'element', 'relationship', 'boundary', 'scene', 'connection'],
    `${path}.kind`
  );
  if (kind === 'connection') {
    const input = object(value, ['kind', 'ownerModel', 'connectionId'], path);
    return {
      kind,
      ownerModel: model(input.ownerModel, `${path}.ownerModel`),
      connectionId: id(input.connectionId, `${path}.connectionId`)
    };
  }
  const input = object(value, ['kind', 'model', ...(kind === 'project' ? [] : [kind])], path);
  const owner = model(input.model, `${path}.model`);
  if (kind === 'project') return { kind, model: owner };
  return { kind, model: owner, [kind]: id(input[kind], `${path}.${kind}`) } as QualifiedSelection;
}

/** Parses decoded state only. URL codec, model resolution and scene default merging are later slices. */
export function parseCompositionState(value: unknown): CompositionState {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    fail('composition', 'must be JSON serializable');
  }
  if (json !== undefined && new TextEncoder().encode(json).byteLength > MAX_COMPOSITION_STATE_BYTES)
    throw new CompositionContractError(
      'composition',
      `exceeds ${MAX_COMPOSITION_STATE_BYTES} bytes`,
      'budget_exceeded'
    );
  const input = object(
    value,
    [
      'version',
      'root',
      'composition',
      'projects',
      'theme',
      'layout',
      'selection',
      'focusedProject'
    ],
    'composition'
  );
  version(input.version, 'composition.version');
  const root = model(input.root, 'composition.root');
  const projects = list(input.projects, 'composition.projects').map((value, index) => {
    const path = `composition.projects[${index}]`;
    const project = object(value, ['model', 'scene', 'mode', 'view'], path);
    return {
      model: model(project.model, `${path}.model`),
      ...optionalId(project.scene, 'scene', path),
      mode: choice(project.mode, ['open', 'collapsed'], `${path}.mode`),
      view: view(project.view, `${path}.view`)
    };
  });
  if (!projects.length || projects[0].model !== root)
    fail('composition.projects[0]', 'must be the root project');
  unique(
    projects.map((project) => project.model),
    'composition.projects'
  );
  const members = new Set(projects.map((project) => project.model));
  const selected =
    input.selection === undefined ? undefined : selection(input.selection, 'composition.selection');
  if (
    selected &&
    !members.has(selected.kind === 'connection' ? selected.ownerModel : selected.model)
  )
    fail('composition.selection', 'owner must participate in the composition');
  const focusedProject =
    input.focusedProject === undefined
      ? undefined
      : model(input.focusedProject, 'composition.focusedProject');
  if (focusedProject && !members.has(focusedProject))
    fail('composition.focusedProject', 'must participate in the composition');
  return {
    version: 1,
    root,
    ...optionalId(input.composition, 'composition', 'composition'),
    projects,
    theme: choice(input.theme, ['grove', 'graphite', 'midnight'], 'composition.theme'),
    layout: choice(input.layout, ['elk-layered', 'elk-layered-down'], 'composition.layout'),
    ...(selected ? { selection: selected } : {}),
    ...(focusedProject ? { focusedProject } : {})
  };
}

export function parseCompositionDiagnostic(value: unknown): CompositionDiagnostic {
  const path = 'diagnostic';
  const input = object(
    value,
    [
      'code',
      'ownerModel',
      'message',
      'path',
      'linkId',
      'connectionId',
      'target',
      'recovery',
      'budget'
    ],
    path
  );
  const code = choice(
    input.code,
    [
      'model_unavailable',
      'model_invalid',
      'unsupported_version',
      'scene_missing',
      'endpoint_missing',
      'identity_not_explicit',
      'revision_changed',
      'source_changing',
      'budget_exceeded'
    ],
    'diagnostic.code'
  );
  let target: CompositionDiagnostic['target'];
  if (input.target !== undefined) {
    const ref = object(input.target, ['model', 'element', 'scene'], 'diagnostic.target');
    target = {
      model: model(ref.model, 'diagnostic.target.model'),
      ...optionalId(ref.element, 'element', 'diagnostic.target'),
      ...optionalId(ref.scene, 'scene', 'diagnostic.target')
    };
  }
  let budget: CompositionDiagnostic['budget'];
  if (input.budget !== undefined) {
    const entry = object(input.budget, ['resource', 'actual', 'limit'], 'diagnostic.budget');
    for (const key of ['actual', 'limit'])
      if (
        typeof entry[key] !== 'number' ||
        !Number.isFinite(entry[key]) ||
        (entry[key] as number) < 0
      )
        fail(`diagnostic.budget.${key}`, 'must be a finite nonnegative number');
    budget = {
      resource: id(entry.resource, 'diagnostic.budget.resource'),
      actual: entry.actual as number,
      limit: entry.limit as number
    };
  }
  if ((code === 'budget_exceeded') !== Boolean(budget))
    fail('diagnostic.budget', 'required only for budget_exceeded');
  return {
    code,
    ownerModel: model(input.ownerModel, 'diagnostic.ownerModel'),
    message: text(input.message, 'diagnostic.message'),
    ...optionalId(input.path, 'path', path),
    ...optionalId(input.linkId, 'linkId', path),
    ...optionalId(input.connectionId, 'connectionId', path),
    ...(target ? { target } : {}),
    recovery: choice(
      input.recovery,
      ['register', 'retry', 'repair', 'upgrade', 'reload', 'reduce'],
      'diagnostic.recovery'
    ),
    ...(budget ? { budget } : {})
  };
}
