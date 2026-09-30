/** Last successfully rendered views, scoped to this tab and exact model revision.
 * URLs remain authoritative; callers consult these only when opening a view without one.
 * Session storage survives full-page surface switches without persisting presentation choices forever.
 */
export function rememberSessionView<T>(
  surface: 'sequence' | 'architecture',
  model: string,
  id: string,
  revision: string,
  state: T
): void {
  try {
    sessionStorage.setItem(key(surface, model, id), JSON.stringify({ revision, state }));
  } catch {
    /* Storage is optional, including in standalone files and private browsing. */
  }
}

export function sessionView<T>(
  surface: 'sequence' | 'architecture',
  model: string,
  id: string,
  revision: string
): T | null {
  try {
    const storageKey = key(surface, model, id);
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (saved?.revision === revision && saved.state && typeof saved.state === 'object')
      return saved.state as T;
    // A source change can remove identities or change defaults. Start from its authored view.
    if (saved) sessionStorage.removeItem(storageKey);
  } catch {
    /* Unavailable or invalid storage is equivalent to no remembered view. */
  }
  return null;
}

function key(surface: string, model: string, id: string): string {
  return `fractal.sessionView.v1.${JSON.stringify([surface, model, id])}`;
}
