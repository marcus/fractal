import type { Theme, ThemeId } from './types';
export type { Theme, ThemeId } from './types';

/** Shared presentation palettes for every Fractal surface and export adapter. */
export const THEMES: readonly Theme[] = Object.freeze([
  Object.freeze({
    id: 'grove',
    name: 'Grove',
    description: 'Fractal’s original soft green studio palette.',
    appearance: 'light',
    surface: '#f7f8f5',
    linkedSurface: '#eef4ef',
    canvas: '#fafbf8',
    canvasDots: '#cfd6d4',
    card: '#ffffff',
    group: '#f4f6f3',
    text: '#243b34',
    muted: '#67746e',
    subtitle: '#6e7d72',
    legendText: '#54675c',
    subtle: '#78867c',
    edge: '#84948b',
    border: '#d9e0da',
    divider: '#dce2db',
    accent: '#267566',
    accentText: '#ffffff',
    eyebrow: '#607c69',
    proposed: '#a98243',
    label: '#fafbf8',
    labelText: '#66766d',
    shadow: '#263a35',
    hover: '#edf1ea'
  }),
  Object.freeze({
    id: 'graphite',
    name: 'Graphite',
    description: 'A quiet neutral canvas for architecture-heavy presentations.',
    appearance: 'light',
    surface: '#f4f4f2',
    linkedSurface: '#eceeeb',
    canvas: '#f8f8f6',
    canvasDots: '#cececa',
    card: '#ffffff',
    group: '#eeeeeb',
    text: '#292927',
    muted: '#6d6d68',
    subtitle: '#74746f',
    legendText: '#5e5e59',
    subtle: '#7d7d77',
    edge: '#85857f',
    border: '#d5d5d0',
    divider: '#ddddda',
    accent: '#4f5d63',
    accentText: '#ffffff',
    eyebrow: '#626b6f',
    proposed: '#956c35',
    label: '#f8f8f6',
    labelText: '#62625e',
    shadow: '#20201f',
    hover: '#e9e9e6'
  }),
  Object.freeze({
    id: 'midnight',
    name: 'Midnight',
    description: 'A deep charcoal studio with restrained green highlights.',
    appearance: 'dark',
    surface: '#121715',
    linkedSurface: '#1a231f',
    canvas: '#151b19',
    canvasDots: '#34403b',
    card: '#1d2522',
    group: '#18201d',
    text: '#edf3ef',
    muted: '#a5b1ab',
    subtitle: '#aebbb5',
    legendText: '#b8c5bf',
    subtle: '#89958f',
    edge: '#82928b',
    border: '#3a4641',
    divider: '#303a36',
    accent: '#79c2a2',
    accentText: '#102019',
    eyebrow: '#8fcdb1',
    proposed: '#ddb466',
    label: '#151b19',
    labelText: '#c2cdc7',
    shadow: '#000000',
    hover: '#25302b'
  })
]);

const byId = new Map(THEMES.map((theme) => [theme.id, theme]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && byId.has(value as ThemeId);
}

/** Resolve the effective palette. Omitted themes deliberately retain the original Grove look. */
export function getTheme(id?: string): Theme {
  const requested = id ?? 'grove';
  const theme = byId.get(requested as ThemeId);
  if (!theme)
    throw new Error(
      `Unknown theme: ${requested}. Choose ${THEMES.map((item) => item.id).join(', ')}`
    );
  return theme;
}
