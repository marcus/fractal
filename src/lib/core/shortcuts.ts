export type ShortcutContext = 'studio' | 'presentation' | 'canvas';
export type ShortcutMode = Exclude<ShortcutContext, 'canvas'>;

export type CommandId =
  | 'jump'
  | 'projects'
  | 'help'
  | 'info'
  | 'toggle-sidebar'
  | 'toggle-flow'
  | 'open-linked'
  | 'reload-sources'
  | 'toggle-presentation'
  | 'export'
  | 'copy-link'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'previous-scene'
  | 'next-scene'
  | 'inspect'
  | 'activate'
  | 'toggle'
  | 'outward'
  | 'escape';

export interface Shortcut {
  readonly id: CommandId;
  readonly label: string;
  readonly group: 'Global' | 'View' | 'Canvas' | 'Presentation';
  readonly keys: readonly string[];
  readonly contexts: readonly ShortcutContext[];
  readonly keyContexts?: Readonly<Partial<Record<string, readonly ShortcutMode[]>>>;
  readonly repeat?: boolean;
}

/** The single discoverable shortcut contract shared by the studio and CLI. */
export const SHORTCUTS = [
  {
    id: 'projects',
    label: 'Switch project',
    group: 'Global',
    keys: ['mod+shift+k'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'jump',
    label: 'Jump to project, component, relationship, or scene',
    group: 'Global',
    keys: ['mod+k'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'info',
    label: 'Show diagram key',
    group: 'View',
    keys: ['i'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'help',
    label: 'Show keyboard shortcuts',
    group: 'Global',
    keys: ['?'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle sidebar',
    group: 'View',
    keys: ['mod+b'],
    contexts: ['studio']
  },
  {
    id: 'toggle-flow',
    label: 'Flow top to bottom',
    group: 'View',
    keys: ['f'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'open-linked',
    label: 'Open linked diagram',
    group: 'Global',
    keys: ['mod+shift+l'],
    contexts: ['studio']
  },
  {
    id: 'reload-sources',
    label: 'Reload changed sources',
    group: 'View',
    keys: ['mod+shift+r'],
    contexts: ['studio']
  },
  {
    id: 'toggle-presentation',
    label: 'Toggle presentation',
    group: 'View',
    keys: ['mod+enter'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'export',
    label: 'Export current view',
    group: 'View',
    keys: ['mod+shift+e'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'copy-link',
    label: 'Copy view link',
    group: 'View',
    keys: ['mod+shift+c'],
    contexts: ['studio', 'presentation']
  },
  {
    id: 'previous-scene',
    label: 'Previous scene',
    group: 'Presentation',
    keys: ['arrowleft'],
    contexts: ['presentation']
  },
  {
    id: 'next-scene',
    label: 'Next scene',
    group: 'Presentation',
    keys: ['arrowright'],
    contexts: ['presentation']
  },
  {
    id: 'zoom-in',
    label: 'Zoom in',
    group: 'Canvas',
    keys: ['=', '+'],
    contexts: ['studio', 'presentation', 'canvas'],
    repeat: true
  },
  {
    id: 'zoom-out',
    label: 'Zoom out',
    group: 'Canvas',
    keys: ['-'],
    contexts: ['studio', 'presentation', 'canvas'],
    repeat: true
  },
  {
    id: 'fit',
    label: 'Fit diagram',
    group: 'Canvas',
    keys: ['0'],
    contexts: ['studio', 'presentation', 'canvas']
  },
  {
    id: 'move-left',
    label: 'Move focus left',
    group: 'Canvas',
    keys: ['arrowleft', 'h', 'a'],
    contexts: ['studio', 'presentation', 'canvas'],
    keyContexts: { arrowleft: ['studio'] },
    repeat: true
  },
  {
    id: 'move-right',
    label: 'Move focus right',
    group: 'Canvas',
    keys: ['arrowright', 'l', 'd'],
    contexts: ['studio', 'presentation', 'canvas'],
    keyContexts: { arrowright: ['studio'] },
    repeat: true
  },
  {
    id: 'move-up',
    label: 'Move focus up',
    group: 'Canvas',
    keys: ['arrowup', 'k', 'w'],
    contexts: ['studio', 'presentation', 'canvas'],
    repeat: true
  },
  {
    id: 'move-down',
    label: 'Move focus down',
    group: 'Canvas',
    keys: ['arrowdown', 'j', 's'],
    contexts: ['studio', 'presentation', 'canvas'],
    repeat: true
  },
  {
    id: 'inspect',
    label: 'Inspect component',
    group: 'Canvas',
    keys: ['enter'],
    contexts: ['studio', 'canvas']
  },
  {
    id: 'toggle',
    label: 'Expand or collapse component',
    group: 'Canvas',
    keys: ['space'],
    contexts: ['studio', 'presentation', 'canvas']
  },
  {
    id: 'activate',
    label: 'Inspect connection / toggle component',
    group: 'Presentation',
    keys: ['enter'],
    contexts: ['presentation']
  },
  {
    id: 'outward',
    label: 'Move outward one level',
    group: 'Canvas',
    keys: ['backspace'],
    contexts: ['studio', 'presentation', 'canvas']
  },
  {
    id: 'escape',
    label: 'Close or exit',
    group: 'Global',
    keys: ['escape'],
    contexts: ['studio', 'presentation']
  }
] as const satisfies readonly Shortcut[];

/** Surface-specific wording uses the same commands and bindings. */
export function shortcutsForSurface(
  surface: 'architecture' | 'sequence' | 'portable' = 'architecture'
): readonly Shortcut[] {
  if (surface === 'architecture') return SHORTCUTS;
  if (surface === 'portable')
    return SHORTCUTS.filter(
      (command) =>
        ![
          'projects',
          'toggle-presentation',
          'previous-scene',
          'next-scene',
          'activate',
          'info',
          'open-linked',
          'reload-sources'
        ].includes(command.id)
    ).map((command) => ({
      ...command,
      label: command.id === 'jump' ? 'Find a component, connection or perspective' : command.label
    }));
  const labels: Partial<Record<CommandId, string>> = {
    jump: 'Jump to project, component, connection, view, or journey',
    'previous-scene': 'Previous journey',
    'next-scene': 'Next journey',
    inspect: 'Inspect participant or interaction',
    toggle: 'Fold or unfold phase / participant group',
    activate: 'Select participant or interaction',
    outward: 'Clear canvas focus'
  };
  // Flow direction belongs to architecture placement; the sequence surface has no engine to swap.
  return SHORTCUTS.filter(
    (command) =>
      command.id !== 'info' &&
      command.id !== 'toggle-flow' &&
      command.id !== 'open-linked' &&
      command.id !== 'reload-sources'
  ).map((command) => ({
    ...command,
    label: labels[command.id] ?? command.label
  }));
}

export interface ShortcutEvent {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
}

export interface ShortcutResolverContext {
  readonly presentation: boolean;
  readonly canvas: boolean;
  readonly editable: boolean;
  readonly interactive: boolean;
  readonly modal: boolean;
}

const keyAliases: Readonly<Record<string, string>> = {
  esc: 'escape',
  spacebar: 'space',
  ' ': 'space'
};

function normalizedKey(key: string): string {
  const normalized = key.toLocaleLowerCase();
  return keyAliases[normalized] ?? normalized;
}

/** Return only the bindings that are truthful for one application mode. */
export function shortcutKeys(shortcut: Shortcut, mode: ShortcutMode): readonly string[] {
  if (!shortcut.contexts.includes(mode)) return [];
  return shortcut.keys.filter((key) => {
    const contexts = shortcut.keyContexts?.[key];
    return contexts === undefined || contexts.includes(mode);
  });
}

function contextMatches(
  shortcut: Shortcut,
  context: ShortcutResolverContext,
  mode: ShortcutMode
): boolean {
  if (!shortcut.contexts.includes(mode)) return false;
  // In presentation the diagram is the whole surface. In the studio, canvas
  // commands require explicit canvas focus/hover from the adapter.
  return context.presentation || !shortcut.contexts.includes('canvas') || context.canvas;
}

function bindingMatches(binding: string, event: ShortcutEvent): boolean {
  const parts = binding === '+' ? ['+'] : binding.toLocaleLowerCase().split('+');
  const key = parts.at(-1)!;
  const wantsMod = parts.includes('mod');
  const wantsMeta = parts.includes('meta');
  const wantsCtrl = parts.includes('ctrl');
  const wantsAlt = parts.includes('alt');
  const wantsShift = parts.includes('shift');
  const shiftedSymbol = key === '?' || key === '+';
  const meta = Boolean(event.metaKey);
  const ctrl = Boolean(event.ctrlKey);

  if (wantsMod ? meta === ctrl : meta !== wantsMeta || ctrl !== wantsCtrl) return false;
  if (
    Boolean(event.altKey) !== wantsAlt ||
    (!shiftedSymbol && Boolean(event.shiftKey) !== wantsShift)
  )
    return false;
  return normalizedKey(event.key) === normalizedKey(key);
}

/** Resolve an app command without depending on DOM event or element types. */
export function resolveShortcut(
  event: ShortcutEvent,
  context: ShortcutResolverContext
): CommandId | null {
  if (event.isComposing) return null;
  const mode: ShortcutMode = context.presentation ? 'presentation' : 'studio';

  for (const shortcut of SHORTCUTS) {
    if (!contextMatches(shortcut, context, mode)) continue;
    if (!shortcutKeys(shortcut, mode).some((binding) => bindingMatches(binding, event))) continue;
    if (context.modal && shortcut.id !== 'escape') return null;
    if (
      context.editable &&
      shortcut.id !== 'jump' &&
      shortcut.id !== 'projects' &&
      shortcut.id !== 'escape'
    )
      return null;
    if (context.interactive && !event.metaKey && !event.ctrlKey && shortcut.id !== 'escape')
      return null;
    return event.repeat && !(shortcut as Shortcut).repeat ? null : shortcut.id;
  }
  return null;
}

const displayKeys: Readonly<Record<string, string>> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  backspace: 'Backspace',
  enter: 'Enter',
  escape: 'Esc',
  space: 'Space'
};

function bindingLabel(binding: string, mac: boolean): string {
  const parts = binding === '+' ? ['+'] : binding.toLocaleLowerCase().split('+');
  const key = parts.pop()!;
  const modifiers = parts.map((part) => {
    if (part === 'mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'meta') return mac ? '⌘' : 'Meta';
    if (part === 'ctrl') return mac ? '⌃' : 'Ctrl';
    if (part === 'alt') return mac ? '⌥' : 'Alt';
    if (part === 'shift') return mac ? '⇧' : 'Shift';
    return part;
  });
  const renderedKey = displayKeys[key] ?? (key.length === 1 ? key.toLocaleUpperCase() : key);
  return mac ? `${modifiers.join('')}${renderedKey}` : [...modifiers, renderedKey].join('+');
}

/** Format a registry row or one key binding for a platform-aware help surface. */
export function shortcutLabel(shortcut: Shortcut | string, mac = false): string {
  const keys = typeof shortcut === 'string' ? [shortcut] : shortcut.keys;
  return keys.map((key) => bindingLabel(key, mac)).join(' / ');
}
