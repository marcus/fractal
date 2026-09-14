/** JSON tuples preserve kind, owner and every character; never split these keys by a delimiter. */
export function qualifiedKey(
  kind:
    | 'project'
    | 'element'
    | 'relationship'
    | 'connection'
    | 'boundary'
    | 'scene'
    | 'link'
    | 'evidence',
  model: string,
  ...localIds: string[]
): string {
  return JSON.stringify([kind, model, ...localIds]);
}
