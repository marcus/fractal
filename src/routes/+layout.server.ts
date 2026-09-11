import type { LayoutServerLoad } from './$types';
import { isThemeId } from '$lib/core/themes';

/**
 * The theme is decided before the first paint. A theme named in the URL wins (a link carried
 * over from another surface), then the theme carried in a view state, then the one the reader
 * last used, remembered in a cookie so the server renders it. Without this, every load and
 * every hop between the architecture and sequence studios flashed the default palette first.
 */
export const load: LayoutServerLoad = ({ cookies, url }) => {
  const fromState = (key: string): unknown => {
    try {
      return JSON.parse(url.searchParams.get(key) ?? 'null')?.theme;
    } catch {
      return undefined;
    }
  };
  const candidates = [
    url.searchParams.get('theme'),
    fromState('view'),
    fromState('seq'),
    cookies.get('fractal.theme')
  ];
  return { theme: candidates.find(isThemeId) ?? 'grove' };
};
