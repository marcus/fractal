import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';

const companion = () => ({
  version: 1,
  id: 'sample',
  title: 'Sample',
  description: '',
  provenance: 'Authored test fixture',
  boundaries: [] as unknown[],
  scenes: [
    {
      id: 'overview',
      title: 'Overview',
      description: '',
      expanded: [] as string[],
      proposed: false,
      lens: 'structure'
    }
  ]
});
const source = `
 specification { element system element component relationship calls tag current tag proposed }
 model {
   system = system 'System' {
     metadata { uid 'stable-system' }
     api = component 'API' {
       description 'Accept requests'
       metadata { uid 'stable-api' evidence ['src/api.ts', 'docs/api.md'] fractalColor '#739886' }
     }
     next = component 'Next' { #proposed metadata { uid 'stable-next' } }
     api .calls next 'Invokes' { metadata { uid 'stable-call' } }
   }
 }
 views { view index { include * } }
`;

test('LikeC4 compiles authored hierarchy, independent identities and proposed relationships', async () => {
  const model = await parseModel(source, companion());
  const api = model.elements.find((element) => element.id === 'stable-api')!;
  assert.equal(api.sourceId, 'system.api');
  assert.equal(api.parent, 'stable-system');
  assert.equal(api.description, 'Accept requests');
  assert.deepEqual(api.evidence, ['src/api.ts', 'docs/api.md']);
  assert.equal(api.color, '#739886');
  assert.equal(api.status, 'current');
  assert.deepEqual(
    model.relationships.map(({ id, source, target, status }) => ({ id, source, target, status })),
    [{ id: 'stable-call', source: 'stable-api', target: 'stable-next', status: 'proposed' }]
  );
  const moved = await parseModel(
    source.replaceAll('system = system', 'renamed = system'),
    companion()
  );
  assert.deepEqual(
    moved.elements.map((element) => element.id),
    model.elements.map((element) => element.id)
  );
});

test('unannotated models can import with source IDs as documented fallback', async () => {
  const model = await parseModel(
    'specification { element component } model { api = component }',
    companion()
  );
  assert.equal(model.elements[0].id, 'api');
  assert.equal(model.elements[0].parent, null);
  assert.equal(model.elements[0].status, 'current');
});

test('rejects ambiguous identities and contradictory status', async () => {
  await assert.rejects(
    parseModel(source.replace("uid 'stable-api'", "uid 'stable-system'"), companion()),
    /duplicate IDs/
  );
  await assert.rejects(
    parseModel(source.replace("uid 'stable-api'", "uid ['one', 'two']"), companion()),
    /uid must be a non-empty string/
  );
  await assert.rejects(
    parseModel(source.replace('#proposed metadata', '#proposed #current metadata'), companion()),
    /conflicting status/
  );
  await assert.rejects(
    parseModel(
      source.replace("uid 'stable-api'", "uid 'stable-api' status 'invented'"),
      companion()
    ),
    /status must be current or proposed/
  );
});

test('proposed container status is inherited by its descendants', async () => {
  const model = await parseModel(
    source.replace("system = system 'System' {", "system = system 'System' { #proposed"),
    companion()
  );
  assert.ok(model.elements.every((element) => element.status === 'proposed'));
});

test('rejects unsafe colors, unresolved endpoints and competing companion definitions', async () => {
  await assert.rejects(
    parseModel(source.replace('#739886', 'url(javascript:evil)'), companion()),
    /six-digit hex color/
  );
  await assert.rejects(
    parseModel(source.replace('api .calls next', 'api .calls unknown'), companion()),
    /Invalid model/
  );
  await assert.rejects(
    parseModel(source, { ...companion(), elements: [] }),
    /elements.*belong in LikeC4/
  );
});

test('validates overlapping boundary memberships and saved expansion references', async () => {
  const config = companion();
  config.boundaries = ['network', 'permission'].map((id) => ({
    id,
    title: id,
    description: '',
    kind: id,
    members: ['stable-api'],
    color: '#739886'
  }));
  config.scenes[0].expanded = ['stable-system'];
  const model = await parseModel(source, config);
  assert.equal(model.boundaries.length, 2);
  assert.deepEqual(model.scenes[0].expanded, ['stable-system']);
  const badBoundary = structuredClone(config);
  (badBoundary.boundaries[0] as { members: string[] }).members = ['unknown'];
  await assert.rejects(parseModel(source, badBoundary), /unknown element unknown/);
  const badScene = structuredClone(config);
  badScene.scenes[0].expanded = ['stable-api'];
  await assert.rejects(parseModel(source, badScene), /cannot expand leaf/);
});

test('rejects scenes with missing expanded ancestors and invalid presentation shapes', async () => {
  const nested = source.replace(
    "fractalColor '#739886' }",
    "fractalColor '#739886' }\n child = component 'Child'"
  );
  const config = companion();
  config.scenes[0].expanded = ['stable-api'];
  await assert.rejects(parseModel(nested, config), /must expand ancestor stable-system/);
  await assert.rejects(parseModel(source, { ...companion(), version: 2 }), /version must be 1/);
  await assert.rejects(parseModel(source, { ...companion(), scenes: [] }), /at least one scene/);
  await assert.rejects(
    parseModel(source, { ...companion(), scenes: [{ ...companion().scenes[0], proposed: 'yes' }] }),
    /proposed must be boolean/
  );
});

for (const id of ['delivery', 'observatory']) {
  test(`${id} example compiles with explicit identities and four reusable scenes`, async () => {
    const dsl = await readFile(new URL(`../examples/${id}/model.c4`, import.meta.url), 'utf8');
    const config = JSON.parse(
      await readFile(new URL(`../examples/${id}/fractal.json`, import.meta.url), 'utf8')
    );
    const model = await parseModel(dsl, config);
    assert.equal(model.id, id);
    assert.equal(model.elements.filter((element) => element.parent === null).length, 5);
    assert.deepEqual(
      model.scenes.map((scene) => scene.id),
      ['overview', 'execution', 'trust', 'proposal']
    );
    assert.ok(
      model.elements.some(
        (element) =>
          element.parent && model.elements.find((parent) => parent.id === element.parent)?.parent
      )
    );
    assert.equal(
      [...dsl.matchAll(/uid '/g)].length,
      model.elements.length + model.relationships.length
    );
    if (id === 'delivery')
      assert.equal(
        model.elements.find((element) => element.id === 'outputs.courier')?.status,
        'proposed'
      );
  });
}

test('scoped scenes retain a nested focus without requiring outside ancestor expansion', async () => {
  const nested = source.replace(
    "fractalColor '#739886' }",
    "fractalColor '#739886' }\n child = component 'Child'"
  );
  const config = companion();
  const scene = { ...config.scenes[0], scope: 'stable-api', expanded: ['stable-api'] };
  const model = await parseModel(nested, { ...config, scenes: [scene] });
  assert.equal(model.scenes[0].scope, 'stable-api');
  assert.deepEqual(model.scenes[0].expanded, ['stable-api']);
  await assert.rejects(
    parseModel(nested, { ...config, scenes: [{ ...scene, scope: 'missing' }] }),
    /scope references unknown element missing/
  );
  await assert.rejects(
    parseModel(nested, { ...config, scenes: [{ ...scene, expanded: ['stable-system'] }] }),
    /outside scope stable-api/
  );
  await assert.rejects(
    parseModel(nested, { ...config, scenes: [{ ...scene, scope: 'stable-next', expanded: [] }] }),
    /scope cannot reference hidden proposed element/
  );
});
