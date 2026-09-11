import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModel } from '../src/lib/server/models';
import { inspectComponent } from '../src/lib/core/inspect';

test('component inspection uses the same current/proposed eligibility as the diagram', async () => {
  const { model } = await loadModel('delivery');
  assert(
    !inspectComponent(model, 'intake', { proposed: false }).children.some(
      (e) => e.status === 'proposed'
    )
  );
  assert(
    inspectComponent(model, 'intake', { proposed: true }).children.some(
      (e) => e.status === 'proposed'
    )
  );
  const current = inspectComponent(model, 'core.routing', { proposed: false });
  assert(!current.relationships.some((r) => r.target === 'outputs.courier'));
  const proposed = inspectComponent(model, 'core.routing', { proposed: true });
  assert(
    proposed.relationships.some((r) => r.target === 'outputs.courier' && r.status === 'proposed')
  );
  assert.throws(() => inspectComponent(model, 'missing', { proposed: false }), /Unknown element/);
});
