import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { compose } from '../src/lib/composition/compose';
import { inspectConnection, inspectQualified } from '../src/lib/composition/inspect';
import { parseCompositionState, parseLinks } from '../src/lib/composition/parse';
import { COMPOSITION_METRICS } from '../src/lib/composition/place';
import {
  closeProject,
  openProject,
  rootState,
  setProjectMode,
  stateFromComposition
} from '../src/lib/composition/state';
import type { ProjectSnapshot } from '../src/lib/composition/snapshot';
import { staticResolver } from '../src/lib/composition/snapshot';
import type { CompositionState, Frame, IdentityOrigins } from '../src/lib/composition/types';
import { layout } from '../src/lib/core/layout';
import type { Point } from '../src/lib/core/types';

const fixture = (path: string) =>
  readFile(new URL(`./fixtures/linked-projects/${path}`, import.meta.url), 'utf8');
const json = async (path: string) => JSON.parse(await fixture(path));

async function snapshot(id: 'host' | 'plugin'): Promise<ProjectSnapshot> {
  const source = await fixture(`${id}/model.c4`);
  const model = await parseModel(source, await json(`${id}/fractal.json`));
  assert.equal(model.id, id);
  return {
    id,
    model,
    links: parseLinks(await json(`${id}/links.json`), id),
    origins: (await json(`${id}/identity-origins.expected.json`)) as IdentityOrigins,
    revision: createHash('sha256').update(`${id}:${source}`).digest('hex')
  };
}

const view = (expanded: string[] = []) => ({
  expanded,
  proposed: false,
  lens: 'structure' as const
});

function stateOf(
  projects: CompositionState['projects'],
  layoutId: CompositionState['layout'] = 'elk-layered'
): CompositionState {
  return parseCompositionState({
    version: 1,
    root: 'host',
    projects,
    theme: 'grove',
    layout: layoutId
  });
}

const openState = (): CompositionState =>
  stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
  ]);

const titleBand = (project: { frame: Frame; titleHeight: number }): Frame => ({
  x: project.frame.x,
  y: project.frame.y,
  width: project.frame.width,
  height: project.titleHeight
});

/** True when an orthogonal segment overlaps the interior of a rectangle (a touch is not a cross). */
function crossesRect(a: Point, b: Point, rect: Frame): boolean {
  if (a.x === b.x)
    return (
      a.x > rect.x &&
      a.x < rect.x + rect.width &&
      Math.max(a.y, b.y) > rect.y &&
      Math.min(a.y, b.y) < rect.y + rect.height
    );
  if (a.y === b.y)
    return (
      a.y > rect.y &&
      a.y < rect.y + rect.height &&
      Math.max(a.x, b.x) > rect.x &&
      Math.min(a.x, b.x) < rect.x + rect.width
    );
  return false;
}

test('host and plugin compose as two frames with both owned bridges and a not_loaded stub', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const composed = await compose(staticResolver([host, plugin]), openState());

  assert.deepEqual(
    composed.projects.map((project) => project.model),
    ['host', 'plugin']
  );
  assert.deepEqual(composed.projects[0].frame.x, 0);
  assert.deepEqual(composed.projects[0].frame.y, 0);
  assert.ok(
    composed.projects[1].frame.x >= composed.projects[0].frame.x + composed.projects[0].frame.width
  );
  assert.equal(composed.projects[1].frame.y, 0);

  assert.deepEqual(
    composed.bridges.map((bridge) => bridge.owner),
    ['host', 'plugin']
  );
  const hostBridge = composed.bridges.find((bridge) => bridge.owner === 'host')!;
  assert.equal(hostBridge.id, 'call');
  assert.equal(hostBridge.title, 'Invokes plugin CLI');
  assert.deepEqual(hostBridge.source.model, 'host');
  assert.deepEqual(hostBridge.source.element, 'cli');
  assert.deepEqual(hostBridge.source.representative, { kind: 'node', id: 'core' });
  assert.deepEqual(hostBridge.target, {
    model: 'plugin',
    element: 'cli',
    representative: { kind: 'node', id: 'core' },
    point: hostBridge.target.point
  });
  assert.ok(hostBridge.points.length >= 3 && hostBridge.points.length <= 5);
  assert.deepEqual(hostBridge.points[0], hostBridge.source.point);
  assert.deepEqual(hostBridge.points[hostBridge.points.length - 1], hostBridge.target.point);

  const pluginBridge = composed.bridges.find((bridge) => bridge.owner === 'plugin')!;
  assert.equal(pluginBridge.title, 'Reports plugin status');
  assert.deepEqual([pluginBridge.source.model, pluginBridge.source.element], ['plugin', 'cli']);
  assert.deepEqual([pluginBridge.target.model, pluginBridge.target.element], ['host', 'cli']);

  assert.equal(composed.stubs.length, 1);
  const stub = composed.stubs[0];
  assert.equal(stub.linkId, 'unavailable');
  assert.equal(stub.state, 'not_loaded');
  assert.deepEqual(stub.anchor, { model: 'host' });
  assert.deepEqual(stub.target, { model: 'missing-plugin' });
  assert.equal(stub.title, 'Unregistered plugin');
  assert.deepEqual(composed.diagnostics, []);
});

test('a collapsed project routes to its summary card at the fixed summary size', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'collapsed', view: view() }
  ]);
  const composed = await compose(staticResolver([host, plugin]), state);

  const project = composed.projects[1];
  assert.equal(project.mode, 'collapsed');
  assert.equal(project.diagram, null);
  assert.equal(project.frame.width, COMPOSITION_METRICS.summary.width);
  assert.equal(project.frame.height, COMPOSITION_METRICS.summary.height);
  assert.equal(project.content.width, 0);
  assert.equal(project.content.height, 0);

  const hostBridge = composed.bridges.find((bridge) => bridge.owner === 'host')!;
  assert.deepEqual(hostBridge.target.representative, { kind: 'project' });
  assert.deepEqual(
    composed.bridges.find((bridge) => bridge.owner === 'plugin')!.source.representative,
    { kind: 'project' }
  );
});

test('a participating but unavailable target is diagnosed, omitted and stubbed as unavailable', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
    { model: 'missing-plugin', mode: 'open', view: view() }
  ]);
  const composed = await compose(staticResolver([host, plugin]), state);

  assert.deepEqual(
    composed.projects.map((project) => project.model),
    ['host', 'plugin']
  );
  const diagnostic = composed.diagnostics.find((entry) => entry.code === 'model_unavailable')!;
  assert.equal(diagnostic.ownerModel, 'host');
  assert.equal(diagnostic.linkId, 'unavailable');
  assert.equal(diagnostic.recovery, 'register');
  assert.deepEqual(diagnostic.target, { model: 'missing-plugin' });

  const stub = composed.stubs.find((entry) => entry.target.model === 'missing-plugin')!;
  assert.equal(stub.state, 'unavailable');
  assert.equal(stub.owner, 'host');
});

test('local diagrams equal a standalone layout of the same model and view', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const state = stateOf([
    { model: 'host', scene: 'detail', mode: 'open', view: view(['core']) },
    { model: 'plugin', scene: 'detail', mode: 'open', view: view(['core']) }
  ]);
  const composed = await compose(staticResolver([host, plugin]), state);
  const positions = (diagram: NonNullable<(typeof composed.projects)[number]['diagram']>) =>
    diagram.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    }));

  for (const project of composed.projects) {
    const standalone = await layout(project.model === 'host' ? host.model : plugin.model, {
      ...state.projects.find((entry) => entry.model === project.model)!.view,
      theme: state.theme,
      layout: state.layout
    });
    assert.deepEqual(positions(project.diagram!), positions(standalone));
  }
});

test('authored links and connections fail validation with typed diagnostics and are never drawn', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const base = host.links!;
  const modified: ProjectSnapshot = {
    ...host,
    links: {
      ...base,
      links: [{ ...base.links[0], from: 'core.fallback' }, base.links[1]],
      connections: [{ ...base.connections[0], target: { model: 'plugin', element: 'removed' } }]
    }
  };
  const state = stateOf([
    { model: 'host', scene: 'detail', mode: 'open', view: view(['core']) },
    { model: 'plugin', scene: 'detail', mode: 'open', view: view(['core']) }
  ]);
  const composed = await compose(staticResolver([modified, plugin]), state);

  const identity = composed.diagnostics.find((entry) => entry.code === 'identity_not_explicit')!;
  assert.equal(identity.ownerModel, 'host');
  assert.equal(identity.linkId, 'plugin');
  assert.equal(identity.path, 'links.links[0].from');
  assert.equal(identity.recovery, 'repair');

  const missing = composed.diagnostics.find((entry) => entry.code === 'endpoint_missing')!;
  assert.equal(missing.ownerModel, 'host');
  assert.equal(missing.connectionId, 'call');
  assert.equal(missing.path, 'links.connections[0].target');
  assert.deepEqual(missing.target, { model: 'plugin', element: 'removed' });

  assert.ok(!composed.bridges.some((bridge) => bridge.owner === 'host'));
  assert.ok(composed.bridges.some((bridge) => bridge.owner === 'plugin'));
});

test('a missing scene is diagnosed and composition falls back to the first scene', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const state = parseCompositionState({
    version: 1,
    root: 'host',
    projects: [
      { model: 'host', scene: 'nope', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
    ],
    theme: 'grove',
    layout: 'elk-layered'
  });
  const composed = await compose(staticResolver([host, plugin]), state);
  const diagnostic = composed.diagnostics.find((entry) => entry.code === 'scene_missing')!;
  assert.equal(diagnostic.ownerModel, 'host');
  assert.equal(diagnostic.path, 'composition.projects[0].scene');
  assert.equal(composed.projects[0].scene, 'overview');
});

test('compose is deterministic across repeated calls', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const state = openState();
  const resolver = () => staticResolver([host, plugin]);
  const first = await compose(resolver(), state);
  const second = await compose(resolver(), state);
  assert.deepEqual(first, second);
});

test('a root that cannot be resolved blocks composition', async () => {
  const plugin = await snapshot('plugin');
  await assert.rejects(() => compose(staticResolver([plugin]), openState()), /Root project host/);
});

test('stateFromComposition and the state transitions round-trip through the parser', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const resolved = (model: string) => (model === 'plugin' ? plugin : undefined);

  const state = stateFromComposition(host, 'plugins', resolved);
  assert.deepEqual(
    state.projects.map((project) => project.model),
    ['host', 'plugin']
  );
  assert.equal(state.composition, 'plugins');
  assert.equal(state.projects[0].scene, 'overview');
  assert.equal(state.projects[1].mode, 'open');
  assert.equal(state.theme, 'grove');
  assert.equal(state.layout, 'elk-layered');
  assert.deepEqual(parseCompositionState(state), state);

  const unresolved = stateFromComposition(host, 'plugins', () => undefined);
  assert.deepEqual(unresolved.projects[1].view, {
    expanded: [],
    proposed: false,
    lens: 'structure'
  });
  assert.equal(unresolved.projects[1].scene, 'overview');
  assert.deepEqual(parseCompositionState(unresolved), unresolved);

  assert.deepEqual(openProject(state, plugin), state);
  const closed = closeProject(state, 'plugin');
  assert.deepEqual(
    closed.projects.map((project) => project.model),
    ['host']
  );
  const reopened = openProject(closed, plugin, 'detail');
  assert.deepEqual(
    reopened.projects.map((project) => project.model),
    ['host', 'plugin']
  );
  assert.equal(reopened.projects[1].scene, 'detail');
  assert.deepEqual(parseCompositionState(reopened), reopened);

  const collapsed = setProjectMode(state, 'plugin', 'collapsed');
  assert.equal(collapsed.projects[1].mode, 'collapsed');
  assert.deepEqual(parseCompositionState(collapsed), collapsed);

  const selected = parseCompositionState({
    ...state,
    selection: { kind: 'connection', ownerModel: 'plugin', connectionId: 'call' },
    focusedProject: 'plugin'
  });
  const cleared = closeProject(selected, 'plugin');
  assert.equal(cleared.selection, undefined);
  assert.equal(cleared.focusedProject, undefined);

  assert.throws(() => closeProject(state, 'host'), /root project/);
  assert.throws(() => setProjectMode(state, 'missing', 'open'), /Unknown project/);
  assert.throws(() => stateFromComposition(host, 'absent', resolved), /Unknown composition/);
});

test('rootState derives a root-only open composition from scene and options', async () => {
  const host = await snapshot('host');
  const state = rootState(host);
  assert.deepEqual(
    state.projects.map((project) => project.model),
    ['host']
  );
  assert.equal(state.projects[0].mode, 'open');
  assert.equal(state.projects[0].scene, 'overview');
  assert.equal(state.theme, 'grove');
  assert.equal(state.layout, 'elk-layered');
  assert.deepEqual(parseCompositionState(state), state);

  const detail = rootState(host, {
    scene: 'detail',
    theme: 'midnight',
    layout: 'elk-layered-down'
  });
  assert.equal(detail.projects[0].scene, 'detail');
  assert.deepEqual(detail.projects[0].view.expanded, ['core']);
  assert.equal(detail.theme, 'midnight');
  assert.equal(detail.layout, 'elk-layered-down');

  assert.throws(() => rootState(host, { scene: 'nope' }), /Unknown scene/);
});

test('inspectConnection names exact endpoint titles and reports representatives separately', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const lookup = (model: string) =>
    model === 'host' ? host.model : model === 'plugin' ? plugin.model : undefined;
  const state = stateOf([
    { model: 'host', scene: 'detail', mode: 'open', view: view(['core']) },
    { model: 'plugin', scene: 'detail', mode: 'open', view: view(['core']) }
  ]);
  const composed = await compose(staticResolver([host, plugin]), state);
  const inspection = inspectConnection(composed, lookup, {
    ownerModel: 'host',
    connectionId: 'call'
  });

  assert.equal(inspection.owner, 'host');
  assert.deepEqual(inspection.route.source, {
    project: 'Harbor host',
    component: 'Plugin adapter'
  });
  assert.deepEqual(inspection.route.target, {
    project: 'Beacon plugin',
    component: 'Plugin CLI'
  });
  assert.deepEqual(inspection.endpoints, {
    source: { model: 'host', element: 'cli' },
    target: { model: 'plugin', element: 'cli' }
  });
  assert.deepEqual(inspection.representatives, {
    source: {
      model: 'host',
      element: 'cli',
      representative: { kind: 'node', id: 'cli' },
      title: 'Plugin adapter'
    },
    target: {
      model: 'plugin',
      element: 'cli',
      representative: { kind: 'node', id: 'cli' },
      title: 'Plugin CLI'
    }
  });
  assert.deepEqual(inspection.claim.evidence, ['src/plugins/beacon.ts']);
  assert.equal(inspection.claim.status, 'current');
  assert.throws(
    () => inspectConnection(composed, lookup, { ownerModel: 'host', connectionId: 'absent' }),
    /Unknown connection/
  );

  // With the endpoint hidden, the drawn representative is an ancestor: the readable route still
  // names the exact endpoint, while representatives report the titled stand-in.
  const collapsed = await compose(
    staticResolver([host, plugin]),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
    ])
  );
  const hidden = inspectConnection(collapsed, lookup, {
    ownerModel: 'host',
    connectionId: 'call'
  });
  assert.deepEqual(hidden.route.source, { project: 'Harbor host', component: 'Plugin adapter' });
  assert.deepEqual(hidden.representatives.source, {
    model: 'host',
    element: 'cli',
    representative: { kind: 'node', id: 'core' },
    title: 'Harbor host'
  });
});

test('inspectQualified handles project, element and connection and rejects phase 2 kinds', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const state = openState();
  const composed = await compose(staticResolver([host, plugin]), state);
  const snapshots = new Map([
    ['host', host],
    ['plugin', plugin]
  ]);

  const project = inspectQualified(composed, snapshots, { kind: 'project', model: 'host' });
  if (project.kind !== 'project') throw new Error('expected project inspection');
  assert.equal(project.model, 'host');
  assert.equal(project.mode, 'open');
  assert.equal(project.scene, 'overview');
  assert.deepEqual(project.counts, { elements: 4, relationships: 1, boundaries: 1, scenes: 2 });

  const element = inspectQualified(composed, snapshots, {
    kind: 'element',
    model: 'host',
    element: 'cli'
  });
  if (element.kind !== 'element') throw new Error('expected element inspection');
  assert.equal(element.model, 'host');
  assert.equal(element.element.id, 'cli');

  const connection = inspectQualified(composed, snapshots, {
    kind: 'connection',
    ownerModel: 'host',
    connectionId: 'call'
  });
  if (connection.kind !== 'connection') throw new Error('expected connection inspection');
  assert.equal(connection.owner, 'host');

  assert.throws(
    () =>
      inspectQualified(composed, snapshots, { kind: 'scene', model: 'host', scene: 'overview' }),
    /not supported in phase 1/
  );
});

test('elk-layered-down places later frames below, left-aligned', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const state = stateOf(
    [
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
    ],
    'elk-layered-down'
  );
  const composed = await compose(staticResolver([host, plugin]), state);
  assert.equal(composed.projects[0].frame.x, 0);
  assert.equal(composed.projects[0].frame.y, 0);
  assert.equal(composed.projects[1].frame.x, 0);
  assert.equal(
    composed.projects[1].frame.y,
    composed.projects[0].frame.y + composed.projects[0].frame.height + COMPOSITION_METRICS.gap
  );
});

test('bridge crossings and labels stay in the inter-frame corridor, clear of every title band', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  for (const engine of ['elk-layered', 'elk-layered-down'] as const) {
    for (const collapsedModel of ['host', 'plugin'] as const) {
      const state = stateOf(
        [
          {
            model: 'host',
            scene: 'detail',
            mode: collapsedModel === 'host' ? 'collapsed' : 'open',
            view: view(['core'])
          },
          {
            model: 'plugin',
            scene: 'detail',
            mode: collapsedModel === 'plugin' ? 'collapsed' : 'open',
            view: view(['core'])
          }
        ],
        engine
      );
      const composed = await compose(staticResolver([host, plugin]), state);
      const projects = new Map(composed.projects.map((project) => [project.model, project]));
      assert.ok(composed.bridges.length >= 1, `${engine}/${collapsedModel} has bridges`);
      for (const bridge of composed.bridges) {
        const label = `${engine}/${collapsedModel} ${bridge.owner}/${bridge.id}`;
        for (const project of composed.projects)
          for (let index = 1; index < bridge.points.length; index++)
            assert.equal(
              crossesRect(bridge.points[index - 1], bridge.points[index], titleBand(project)),
              false,
              `${label} segment ${index} crosses the ${project.model} title band`
            );
        const source = projects.get(bridge.source.model)!;
        const target = projects.get(bridge.target.model)!;
        if (engine === 'elk-layered') {
          const [left, right] =
            source.frame.x <= target.frame.x ? [source, target] : [target, source];
          assert.ok(
            bridge.label.x > left.frame.x + left.frame.width && bridge.label.x < right.frame.x,
            `${label} label x ${bridge.label.x} is outside the corridor`
          );
        } else {
          const [top, bottom] =
            source.frame.y <= target.frame.y ? [source, target] : [target, source];
          assert.ok(
            bridge.label.y > top.frame.y + top.frame.height && bridge.label.y < bottom.frame.y,
            `${label} label y ${bridge.label.y} is outside the corridor`
          );
        }
      }
    }
  }
});
