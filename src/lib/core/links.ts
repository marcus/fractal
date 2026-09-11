import type { ThemeId } from './types';

/**
 * Routes between the two diagram surfaces. Both studios link through these, so a perspective
 * or journey resolves the same way whichever side the reader started from.
 */
export function architectureLink(
  model: string,
  options: { scene?: string; theme?: ThemeId } = {}
): string {
  const params = new URLSearchParams({ model });
  // A saved perspective owns its expansion, lens and scope; only the theme travels with the
  // reader. Sending a `view` here would replace the scene's own state with an empty one.
  if (options.scene) params.set('scene', options.scene);
  if (options.theme) params.set('theme', options.theme);
  return `/?${params}`;
}

export function sequenceLink(model: string, journey: string, theme?: ThemeId): string {
  return `/sequence?${new URLSearchParams({ model, journey, theme: theme ?? 'grove' })}`;
}
