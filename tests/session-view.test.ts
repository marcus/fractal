import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberSessionView, sessionView } from '../src/lib/ui/session-view';

test('view memory isolates models, journeys and surfaces and invalidates changed revisions', () => {
  const records = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => records.set(key, value),
      removeItem: (key: string) => records.delete(key)
    }
  });
  try {
    const state = { collapsedPhases: ['order'], hiddenParticipants: ['picker'] };
    rememberSessionView('sequence', 'delivery', 'order', 'v1', state);
    assert.deepEqual(sessionView('sequence', 'delivery', 'order', 'v1'), state);
    assert.equal(sessionView('sequence', 'other', 'order', 'v1'), null);
    assert.equal(sessionView('sequence', 'delivery', 'other', 'v1'), null);
    assert.equal(sessionView('architecture', 'delivery', 'order', 'v1'), null);
    assert.equal(sessionView('sequence', 'delivery', 'order', 'v2'), null);
    assert.equal(sessionView('sequence', 'delivery', 'order', 'v1'), null);
  } finally {
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
  assert.equal(sessionView('sequence', 'delivery', 'order', 'v1'), null);
  assert.doesNotThrow(() => rememberSessionView('sequence', 'delivery', 'order', 'v1', {}));
});
