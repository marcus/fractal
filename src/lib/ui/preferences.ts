/**
 * Personal chrome preferences. These live in browser storage rather than the URL: a shared or
 * copied link carries a perspective, not the reader's panel layout. Storage is optional
 * everywhere — private modes and server rendering fall back to the default.
 */
const SIDEBAR_COLLAPSED = 'fractal.sidebarCollapsed';
const SIDEBAR_WIDTH = 'fractal.sidebarWidth';
const LAST_PROJECT = 'fractal.lastProject';
const NAVIGATION_SECTION_PREFIX = 'fractal.navigationSection.';

export type NavigationSection = 'perspectives' | 'sequences';
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 360;

/** @returns the stored value, or null when storage is unavailable or unset. */
function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
}

/**
 * Both studio surfaces share one navigation preference, so hiding the sidebar on the
 * architecture view keeps it hidden on sequences and across reloads. `src/app.html` reads the
 * same key before first paint to avoid showing a sidebar the reader has already dismissed.
 */
export function sidebarCollapsedPreference(): boolean {
  return read(SIDEBAR_COLLAPSED) === 'true';
}

export function rememberSidebarCollapsed(collapsed: boolean): void {
  write(SIDEBAR_COLLAPSED, String(collapsed));
}

export function sidebarWidthPreference(): number | null {
  const width = Number(read(SIDEBAR_WIDTH));
  return Number.isFinite(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH
    ? width
    : null;
}

export function rememberSidebarWidth(width: number): void {
  write(SIDEBAR_WIDTH, String(Math.round(width)));
}

/** Sidebar disclosure is personal chrome and deliberately stays out of shared view links. */
export function navigationSectionExpandedPreference(section: NavigationSection): boolean {
  return read(`${NAVIGATION_SECTION_PREFIX}${section}.expanded`) !== 'false';
}

export function rememberNavigationSectionExpanded(
  section: NavigationSection,
  expanded: boolean
): void {
  write(`${NAVIGATION_SECTION_PREFIX}${section}.expanded`, String(expanded));
}

export function lastProject(): string | null {
  return read(LAST_PROJECT);
}

export function rememberLastProject(id: string): void {
  write(LAST_PROJECT, id);
}

/**
 * Floating panels hug their content until the reader drags their bottom edge; that height is
 * personal chrome too. `null` means "fit content". `src/app.html` applies the navigation height
 * before first paint from the same key.
 */
const PANEL_HEIGHT_PREFIX = 'fractal.panelHeight.';
export const PANEL_MIN_HEIGHT = 160;
export type FloatingPanelId = 'navigation' | 'inspector';

export function panelHeightPreference(panel: FloatingPanelId): number | null {
  const height = Number(read(`${PANEL_HEIGHT_PREFIX}${panel}`));
  return Number.isFinite(height) && height >= PANEL_MIN_HEIGHT ? height : null;
}

export function rememberPanelHeight(panel: FloatingPanelId, height: number | null): void {
  write(`${PANEL_HEIGHT_PREFIX}${panel}`, height === null ? null : String(Math.round(height)));
}

/**
 * Where the reader dragged a floating panel, as an offset from the place the layout gives it.
 * Remembered so the inspector reopens where it was left, on the next selection and the next
 * visit alike. `null` means "where the layout puts it". Desktop only; the sheet layout below
 * 761px never moves panels, so a stored offset is ignored there.
 */
const PANEL_OFFSET_PREFIX = 'fractal.panelOffset.';
export type PanelOffset = { x: number; y: number };

export function panelOffsetPreference(panel: FloatingPanelId): PanelOffset | null {
  try {
    const parsed = JSON.parse(read(`${PANEL_OFFSET_PREFIX}${panel}`) ?? 'null');
    return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: Math.round(parsed.x), y: Math.round(parsed.y) }
      : null;
  } catch {
    return null;
  }
}

export function rememberPanelOffset(panel: FloatingPanelId, offset: PanelOffset | null): void {
  write(
    `${PANEL_OFFSET_PREFIX}${panel}`,
    offset === null ? null : JSON.stringify({ x: Math.round(offset.x), y: Math.round(offset.y) })
  );
}

/** The floating inspector's width, dragged from its left edge or corner. Classic keeps 284px. */
const INSPECTOR_WIDTH = 'fractal.inspectorWidth';
export const INSPECTOR_MIN_WIDTH = 240;
export const INSPECTOR_MAX_WIDTH = 460;

export function inspectorWidthPreference(): number | null {
  const width = Number(read(INSPECTOR_WIDTH));
  return Number.isFinite(width) && width >= INSPECTOR_MIN_WIDTH && width <= INSPECTOR_MAX_WIDTH
    ? width
    : null;
}

export function rememberInspectorWidth(width: number): void {
  write(INSPECTOR_WIDTH, String(Math.round(width)));
}

/**
 * The theme last shown, as a cookie rather than storage, so the server can render the next
 * page in it and the reader never sees the default palette flash first.
 */
export function rememberTheme(theme: string): void {
  try {
    if (typeof document !== 'undefined')
      document.cookie = `fractal.theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* Cookies are optional. */
  }
}
