import { LikeC4 } from 'likec4';
import type { Boundary, Element, Model, Scene, Status } from '../core/types';
import { getTheme } from '../core/themes';
import { getLayoutEngineInfo } from '../core/layout-engines';

type RecordValue = Record<string, unknown>;
const fallbackColor = '#647D72';
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function object(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as RecordValue;
}
function string(value: unknown, path: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()))
    throw new Error(`${path} must be a ${empty ? '' : 'non-empty '}string`);
  return value;
}
function identity(value: unknown, path: string): string {
  const result = string(value, path);
  if (!identityPattern.test(result))
    throw new Error(`${path} must use letters, numbers, dots, underscores, colons or hyphens`);
  return result;
}
function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => string(item, `${path}[${index}]`));
}
function color(value: unknown, path: string): string {
  if (value === undefined) return fallbackColor;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${path} must be a six-digit hex color`);
  return value;
}
function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} contains duplicate IDs`);
}
function status(
  metadata: RecordValue,
  tags: readonly string[],
  path: string,
  inherited: Status = 'current'
): Status {
  const declared = metadata.status;
  if (declared !== undefined && declared !== 'current' && declared !== 'proposed')
    throw new Error(`${path}.status must be current or proposed`);
  const taggedCurrent = tags.includes('current') || tags.includes('built');
  const taggedProposed = tags.includes('proposed');
  if (
    (taggedCurrent && taggedProposed) ||
    (declared === 'current' && taggedProposed) ||
    (declared === 'proposed' && taggedCurrent)
  )
    throw new Error(`${path} has conflicting status declarations`);
  const result = declared ?? (taggedProposed ? 'proposed' : taggedCurrent ? 'current' : inherited);
  if (inherited === 'proposed' && result === 'current')
    throw new Error(`${path} cannot be current inside a proposed parent`);
  return result;
}

/**
 * Compile authored LikeC4 plus Fractal presentation metadata into the shared model.
 * uid is recommended for durable identity. Unannotated imports fall back to the
 * LikeC4 source ID (hierarchical for elements, generated for relationships), which
 * may change after restructuring. Companion references always use normalized IDs.
 */
export async function parseModel(source: string, companion: unknown): Promise<Model> {
  string(source, 'source');
  const config = object(companion, 'companion');
  const allowed = new Set([
    'version',
    'id',
    'title',
    'description',
    'provenance',
    'boundaries',
    'scenes'
  ]);
  for (const key of Object.keys(config))
    if (!allowed.has(key))
      throw new Error(
        `companion.${key} is unsupported; elements and relationships belong in LikeC4`
      );
  if (config.version !== 1) throw new Error('companion.version must be 1');
  const header = {
    version: 1 as const,
    id: identity(config.id, 'companion.id'),
    title: string(config.title, 'companion.title'),
    description: string(config.description, 'companion.description', true),
    provenance: string(config.provenance, 'companion.provenance')
  };
  if (!Array.isArray(config.boundaries) || !Array.isArray(config.scenes))
    throw new Error('companion.boundaries and companion.scenes must be arrays');
  if (!config.scenes.length) throw new Error('companion.scenes must contain at least one scene');

  const api = await LikeC4.fromSource(source, { throwIfInvalid: true, logger: false });
  try {
    const parsed = await api.computedModel();
    const sourceElements = Array.from(parsed.elements());
    const sourceIds = new Map(
      sourceElements.map((element) => [
        element.id,
        identity(element.getMetadata('uid') ?? element.id, `${element.id}.uid`)
      ])
    );
    const elements: Element[] = [];
    // LikeC4 yields parents before children. Sorting also makes that contract explicit.
    sourceElements.sort((a, b) => a.id.split('.').length - b.id.split('.').length);
    for (const element of sourceElements) {
      const metadata = element.getMetadata() ?? {};
      const parent = element.parent ? sourceIds.get(element.parent.id)! : null;
      const parentElement = elements.find((candidate) => candidate.id === parent);
      const evidenceValue = metadata.evidence;
      elements.push({
        id: sourceIds.get(element.id)!,
        sourceId: element.id,
        parent,
        title: element.title,
        kind: element.kind,
        description: element.description.text ?? '',
        technology: element.technology ?? '',
        status: status(metadata, element.tags, element.id, parentElement?.status),
        color: color(metadata.fractalColor ?? metadata.color, `${element.id}.color`),
        // LikeC4 normalizes single-valued metadata arrays to a scalar.
        evidence:
          evidenceValue === undefined
            ? []
            : typeof evidenceValue === 'string'
              ? [evidenceValue]
              : strings(evidenceValue, `${element.id}.evidence`)
      });
    }
    unique(
      elements.map((element) => element.id),
      'elements'
    );
    if (!elements.length) throw new Error('model must contain at least one element');
    const elementIds = new Set(elements.map((element) => element.id));
    const relationships = Array.from(parsed.relationships()).map((relation) => ({
      id: identity(relation.getMetadata('uid') ?? relation.id, `relationship ${relation.id}.uid`),
      source: sourceIds.get(relation.source.id)!,
      target: sourceIds.get(relation.target.id)!,
      title: relation.title ?? '',
      kind: relation.kind ?? 'relates',
      description: relation.description.text ?? '',
      status: status(relation.getMetadata() ?? {}, relation.tags, `relationship ${relation.id}`)
    }));
    unique(
      relationships.map((relation) => relation.id),
      'relationships'
    );
    for (const relation of relationships) {
      if (!elementIds.has(relation.source) || !elementIds.has(relation.target))
        throw new Error(`relationship ${relation.id} has an unknown endpoint`);
      if (
        elements.some(
          (element) =>
            element.status === 'proposed' &&
            (element.id === relation.source || element.id === relation.target)
        )
      )
        relation.status = 'proposed';
    }
    const boundaries: Boundary[] = config.boundaries.map((value, index) => {
      const path = `boundaries[${index}]`,
        boundary = object(value, path);
      const members = strings(boundary.members, `${path}.members`);
      unique(members, `${path}.members`);
      if (!members.length) throw new Error(`${path}.members must not be empty`);
      for (const member of members)
        if (!elementIds.has(member))
          throw new Error(`${path} references unknown element ${member}`);
      return {
        id: identity(boundary.id, `${path}.id`),
        title: string(boundary.title, `${path}.title`),
        description: string(boundary.description, `${path}.description`, true),
        kind: string(boundary.kind, `${path}.kind`),
        members,
        color: color(boundary.color, `${path}.color`)
      };
    });
    unique(
      boundaries.map((boundary) => boundary.id),
      'boundaries'
    );
    const scenes: Scene[] = config.scenes.map((value, index) => {
      const path = `scenes[${index}]`,
        scene = object(value, path);
      const expanded = strings(scene.expanded, `${path}.expanded`);
      unique(expanded, `${path}.expanded`);
      if (typeof scene.proposed !== 'boolean') throw new Error(`${path}.proposed must be boolean`);
      if (scene.lens !== 'structure' && scene.lens !== 'trust')
        throw new Error(`${path}.lens must be structure or trust`);
      const scope = scene.scope === undefined ? undefined : identity(scene.scope, `${path}.scope`);
      const theme =
        scene.theme === undefined ? undefined : getTheme(string(scene.theme, `${path}.theme`)).id;
      const layout =
        scene.layout === undefined
          ? undefined
          : getLayoutEngineInfo(string(scene.layout, `${path}.layout`)).id;
      if (scope !== undefined) {
        const scopedElement = elements.find((element) => element.id === scope);
        if (!scopedElement) throw new Error(`${path}.scope references unknown element ${scope}`);
        if (!scene.proposed && scopedElement.status === 'proposed')
          throw new Error(`${path}.scope cannot reference hidden proposed element ${scope}`);
      }
      for (const id of expanded) {
        if (!elementIds.has(id)) throw new Error(`${path} references unknown element ${id}`);
        if (!elements.some((element) => element.parent === id))
          throw new Error(`${path} cannot expand leaf ${id}`);
        if (!scene.proposed && elements.find((element) => element.id === id)?.status === 'proposed')
          throw new Error(`${path} cannot expand hidden proposed element ${id}`);
        let ancestor = elements.find((element) => element.id === id)?.parent;
        if (scope && id !== scope) {
          let candidate = ancestor;
          while (candidate && candidate !== scope)
            candidate = elements.find((element) => element.id === candidate)?.parent;
          if (candidate !== scope)
            throw new Error(`${path} cannot expand element ${id} outside scope ${scope}`);
        }
        if (id === scope) continue;
        while (ancestor) {
          if (!expanded.includes(ancestor))
            throw new Error(`${path} must expand ancestor ${ancestor} of ${id}`);
          if (ancestor === scope) break;
          ancestor = elements.find((element) => element.id === ancestor)?.parent;
        }
      }
      return {
        id: identity(scene.id, `${path}.id`),
        title: string(scene.title, `${path}.title`),
        description: string(scene.description, `${path}.description`, true),
        expanded,
        proposed: scene.proposed,
        lens: scene.lens,
        ...(scope ? { scope } : {}),
        ...(theme ? { theme } : {}),
        ...(layout ? { layout } : {})
      };
    });
    unique(
      scenes.map((scene) => scene.id),
      'scenes'
    );
    return { ...header, elements, relationships, boundaries, scenes };
  } finally {
    await api.dispose();
  }
}
