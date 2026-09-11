import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHORTCUTS,
  shortcutsForSurface,
  resolveShortcut,
  shortcutLabel,
  shortcutKeys,
  type Shortcut,
  type ShortcutMode,
  type ShortcutResolverContext
} from '../src/lib/core/shortcuts';

const studio: ShortcutResolverContext = {
  presentation: false,
  canvas: false,
  editable: false,
  interactive: false,
  modal: false
};

test('registry is typed, serializable metadata for help and CLI surfaces', () => {
  assert.ok(SHORTCUTS.every((shortcut) => shortcut.id && shortcut.label && shortcut.keys.length));
  assert.deepEqual(JSON.parse(JSON.stringify(SHORTCUTS)), SHORTCUTS);
  assert.equal(shortcutLabel('mod+shift+e', true), '⌘⇧E');
  assert.equal(shortcutLabel('mod+shift+e'), 'Ctrl+Shift+E');
  assert.equal(
    shortcutLabel(SHORTCUTS.find((shortcut) => shortcut.id === 'move-up')!),
    '↑ / K / W'
  );
  assert.equal(shortcutLabel('+'), '+');
});

test('binding metadata exposes only keys that apply in the requested mode', () => {
  const left = SHORTCUTS.find((shortcut) => shortcut.id === 'move-left')!;
  const right = SHORTCUTS.find((shortcut) => shortcut.id === 'move-right')!;
  assert.deepEqual(left.keyContexts, { arrowleft: ['studio'] });
  assert.deepEqual(right.keyContexts, { arrowright: ['studio'] });
  assert.deepEqual(shortcutKeys(left, 'studio'), ['arrowleft', 'h', 'a']);
  assert.deepEqual(shortcutKeys(left, 'presentation'), ['h', 'a']);
  assert.deepEqual(shortcutKeys(right, 'studio'), ['arrowright', 'l', 'd']);
  assert.deepEqual(shortcutKeys(right, 'presentation'), ['l', 'd']);
  const inspect = SHORTCUTS.find((shortcut) => shortcut.id === 'inspect')!;
  const toggle = SHORTCUTS.find((shortcut) => shortcut.id === 'toggle')!;
  const activate = SHORTCUTS.find((shortcut) => shortcut.id === 'activate')!;
  assert.equal(inspect.label, 'Inspect component');
  assert.deepEqual(shortcutKeys(inspect, 'studio'), ['enter']);
  assert.deepEqual(shortcutKeys(inspect, 'presentation'), []);
  assert.deepEqual(shortcutKeys(toggle, 'studio'), ['space']);
  assert.deepEqual(shortcutKeys(toggle, 'presentation'), ['space']);
  assert.deepEqual(shortcutKeys(activate, 'studio'), []);
  assert.deepEqual(shortcutKeys(activate, 'presentation'), ['enter']);
  assert.deepEqual(
    shortcutKeys(
      SHORTCUTS.find((shortcut) => shortcut.id === 'toggle-sidebar')!,
      'presentation'
    ),
    []
  );
});

test('effective shortcut bindings do not collide in either mode or studio focus context', () => {
  const active = (shortcut: Shortcut, mode: ShortcutMode, canvas: boolean) =>
    shortcut.contexts.includes(mode) &&
    (mode === 'presentation' || !shortcut.contexts.includes('canvas') || canvas);
  const assertNoCollisions = (mode: ShortcutMode, canvas: boolean) => {
    const commands = new Map<string, string>();
    for (const shortcut of SHORTCUTS) {
      if (!active(shortcut, mode, canvas)) continue;
      for (const key of shortcutKeys(shortcut, mode)) {
        assert.equal(
          commands.get(key),
          undefined,
          `${key} resolves to both ${commands.get(key)} and ${shortcut.id} in ${mode}`
        );
        commands.set(key, shortcut.id);
      }
    }
  };
  assertNoCollisions('studio', false);
  assertNoCollisions('studio', true);
  assertNoCollisions('presentation', true);
});

test('global modifier commands work from native controls while their own keys remain native', () => {
  assert.equal(
    resolveShortcut({ key: 'Enter', metaKey: true }, { ...studio, interactive: true }),
    'toggle-presentation'
  );
  assert.equal(
    resolveShortcut({ key: 'b', ctrlKey: true }, { ...studio, interactive: true }),
    'toggle-sidebar'
  );
  assert.equal(
    resolveShortcut({ key: 'Enter' }, { ...studio, canvas: true, interactive: true }),
    null
  );
  assert.equal(resolveShortcut({ key: ' ' }, { ...studio, canvas: true, interactive: true }), null);
  assert.equal(
    resolveShortcut({ key: 'ArrowRight' }, { ...studio, canvas: true, interactive: true }),
    null
  );
});

test('editable, modal, and composition contexts protect their native interaction', () => {
  assert.equal(resolveShortcut({ key: 'k', metaKey: true }, { ...studio, editable: true }), 'jump');
  assert.equal(
    resolveShortcut({ key: 'k', metaKey: true, shiftKey: true }, { ...studio, editable: true }),
    'projects'
  );
  assert.equal(resolveShortcut({ key: 'b', metaKey: true }, { ...studio, editable: true }), null);
  assert.equal(resolveShortcut({ key: 'Escape' }, { ...studio, editable: true }), 'escape');
  assert.equal(resolveShortcut({ key: 'k', metaKey: true }, { ...studio, modal: true }), null);
  assert.equal(resolveShortcut({ key: 'Escape' }, { ...studio, modal: true }), 'escape');
  assert.equal(resolveShortcut({ key: 'Escape', isComposing: true }, studio), null);
});

test('studio canvas navigation is focus-gated and presentation separates scenes from components', () => {
  assert.equal(resolveShortcut({ key: 'ArrowLeft' }, studio), null);
  assert.equal(resolveShortcut({ key: 'ArrowLeft' }, { ...studio, canvas: true }), 'move-left');
  const presentation = { ...studio, presentation: true };
  assert.equal(resolveShortcut({ key: 'ArrowLeft' }, presentation), 'previous-scene');
  assert.equal(resolveShortcut({ key: 'ArrowRight' }, presentation), 'next-scene');
  assert.equal(resolveShortcut({ key: 'h' }, presentation), 'move-left');
  assert.equal(resolveShortcut({ key: 'W', shiftKey: true }, presentation), null);
  assert.equal(resolveShortcut({ key: 'Enter' }, presentation), 'activate');
  assert.equal(resolveShortcut({ key: ' ' }, presentation), 'toggle');
  assert.equal(resolveShortcut({ key: 'Backspace' }, presentation), 'outward');
});

test('only navigation and zoom repeat and unexpected modifiers do not fall through', () => {
  assert.equal(
    resolveShortcut({ key: 'ArrowRight', repeat: true }, { ...studio, presentation: true }),
    null
  );
  assert.equal(
    resolveShortcut({ key: 'h', repeat: true }, { ...studio, presentation: true }),
    'move-left'
  );
  assert.equal(
    resolveShortcut({ key: '+', shiftKey: true, repeat: true }, { ...studio, canvas: true }),
    'zoom-in'
  );
  assert.equal(resolveShortcut({ key: '+', repeat: true }, { ...studio, canvas: true }), 'zoom-in');
  assert.equal(resolveShortcut({ key: ' ', repeat: true }, { ...studio, canvas: true }), null);
  assert.equal(
    resolveShortcut({ key: 'Enter', repeat: true }, { ...studio, presentation: true }),
    null
  );
  assert.equal(
    resolveShortcut({ key: 'ArrowLeft', altKey: true }, { ...studio, canvas: true }),
    null
  );
  assert.equal(resolveShortcut({ key: 'k', metaKey: true, ctrlKey: true }, studio), null);
});

test('sequence help specializes wording while retaining one binding registry', () => {
  const sequence = shortcutsForSurface('sequence');
  assert.equal(
    sequence.some((command) => command.id === 'info'),
    false
  );
  assert.equal(sequence.find((command) => command.id === 'next-scene')?.label, 'Next journey');
  for (const command of sequence) {
    assert.deepEqual(command.keys, SHORTCUTS.find((original) => original.id === command.id)?.keys);
  }
});
