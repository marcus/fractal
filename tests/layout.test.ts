import assert from 'node:assert/strict';
import test from 'node:test';
import { project, textWidth, wrapText } from '../src/lib/core/projection';
import { layout } from '../src/lib/core/layout';
import { exportSvg } from '../src/lib/core/svg';
import { ARCHITECTURE_NODE_METRICS as METRICS } from '../src/lib/core/node-metrics';
import type { Element, Model, Relationship, ViewState } from '../src/lib/core/types';
const element = (
  id: string,
  parent: string | null = null,
  status: 'current' | 'proposed' = 'current'
): Element => ({
  id,
  sourceId: id,
  parent,
  title: id,
  kind: 'service',
  description: 'A useful system component with a clear responsibility.',
  technology: '',
  status,
  color: '#548573',
  evidence: []
});
const edge = (
  id: string,
  source: string,
  target: string,
  kind = 'calls',
  status: 'current' | 'proposed' = 'current'
): Relationship => ({
  id,
  source,
  target,
  kind,
  title: 'Calls interface',
  description: '',
  status
});
const model: Model = {
  version: 1,
  id: 'test',
  title: 'A <system> & its architecture',
  description: 'A model.',
  provenance: 'test',
  elements: [
    element('client'),
    element('core'),
    element('worker', 'core'),
    element('store', 'core'),
    element('future', 'core', 'proposed')
  ],
  relationships: [
    edge('a', 'client', 'worker'),
    edge('b', 'client', 'store'),
    edge('c', 'client', 'worker', 'authorizes'),
    edge('d', 'worker', 'store'),
    edge('e', 'client', 'worker', 'calls', 'proposed')
  ],
  boundaries: [
    {
      id: 'trust',
      title: 'Trusted',
      description: '',
      kind: 'trust',
      members: ['worker'],
      color: '#e6a433'
    }
  ],
  scenes: []
};
const state: ViewState = { expanded: [], proposed: false, lens: 'structure' };

test('collapse retains provenance and separates different relationship semantics', () => {
  const result = project(model, state);
  assert.deepEqual(
    result.elements.map((node) => node.id),
    ['client', 'core']
  );
  assert.equal(result.edges.length, 2);
  assert.deepEqual(result.edges[0].underlying, ['a', 'b']);
  assert.equal(result.edges[1].kind, 'authorizes');
  assert.equal(project(model, { ...state, proposed: true }).edges.length, 3);
  const expanded = project(model, { ...state, expanded: ['core'] });
  assert.equal(expanded.elements.find((node) => node.id === 'worker')?.parent, 'core');
  assert.equal(expanded.edges.find((item) => item.id === 'a')?.target, 'worker');
  assert.ok(!expanded.elements.some((item) => item.id === 'future'));
});

test('rejects unknown view and model references and containment cycles', () => {
  assert.throws(() => project(model, { ...state, expanded: ['missing'] }), /Unknown expanded/);
  assert.throws(
    () => project({ ...model, elements: [element('bad', 'missing')] }, state),
    /Unknown parent/
  );
  assert.throws(
    () => project({ ...model, elements: [element('one', 'two'), element('two', 'one')] }, state),
    /cycle/
  );
});

test('wrapping fits long unbroken words without losing content', () => {
  const word = 'aVeryLongUnbrokenIdentifierWithSomeWideMMMMCharactersAndUnicode界';
  const lines = wrapText(word, 130, 17);
  assert.equal(lines.join(''), word);
  assert.ok(lines.every((line) => textWidth(line, 17) <= 130));
});

test('mixed-depth layout contains children, separates siblings and routes real endpoints deterministically', async () => {
  const current = { ...state, expanded: ['core'] };
  const diagram = await layout(model, current);
  assert.deepEqual(diagram, await layout(model, current));
  const core = diagram.nodes.find((node) => node.id === 'core')!;
  for (const child of diagram.nodes.filter((node) => node.parent === 'core')) {
    assert.ok(child.x > core.x && child.y >= core.y + 56);
    assert.ok(child.x + child.width < core.x + core.width);
    assert.ok(child.y + child.height < core.y + core.height);
  }
  for (const node of diagram.nodes) {
    for (const other of diagram.nodes.filter(
      (item) => item.id !== node.id && item.parent === node.parent
    )) {
      assert.ok(
        node.x + node.width <= other.x ||
          other.x + other.width <= node.x ||
          node.y + node.height <= other.y ||
          other.y + other.height <= node.y
      );
    }
  }
  for (const connection of diagram.edges) {
    assert.ok(connection.points.length >= 2);
    const source = diagram.nodes.find((node) => node.id === connection.source)!;
    const target = diagram.nodes.find((node) => node.id === connection.target)!;
    assert.ok(Math.abs(connection.points[0].x - (source.x + source.width)) <= 2);
    assert.ok(Math.abs(connection.points.at(-1)!.x - target.x) <= 2);
  }
});

test('SVG export is portable, escaped and marks exact members without a synthetic envelope', async () => {
  const diagram = await layout(model, { ...state, expanded: ['core'], lens: 'trust' });
  const svg = exportSvg(model, diagram);
  assert.match(svg, /width="1920" height="1080"/);
  assert.match(svg, /A &lt;system&gt; &amp; its architecture/);
  assert.match(svg, /EXACT MEMBER OUTLINES/);
  assert.ok(!svg.includes('foreignObject'));
  assert.ok(!svg.includes('http') || svg.includes('http://www.w3.org/2000/svg'));
});

test('all authored sample scenes route nested connections and reserve clear label rectangles', async () => {
  const { loadModel } = await import('../src/lib/server/models');
  for (const id of ['delivery', 'observatory']) {
    const { model: sample } = await loadModel(id);
    for (const scene of sample.scenes) {
      const diagram = await layout(sample, scene);
      const labels: { id: string; x: number; y: number; width: number; height: number }[] = [];
      const intersects = (
        a: { x: number; y: number; width: number; height: number },
        b: typeof a
      ) =>
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      for (const connection of diagram.edges) {
        const source = diagram.nodes.find((node) => node.id === connection.source)!;
        const target = diagram.nodes.find((node) => node.id === connection.target)!;
        assert.ok(
          connection.points.length >= 2,
          `${id}/${scene.id}/${connection.id}: missing route`
        );
        assert.ok(Math.abs(connection.points[0].x - source.x - source.width) <= 2);
        assert.ok(Math.abs(connection.points.at(-1)!.x - target.x) <= 2);
        if (!connection.labelLines.length) continue;
        const width = Math.max(...connection.labelLines.map((line) => textWidth(line, 11))) + 14;
        const rectangle = {
          id: connection.id,
          x: connection.label.x - width / 2,
          y: connection.label.y - 13,
          width,
          height: connection.labelLines.length * 15 + 8
        };
        for (const node of diagram.nodes.filter((item) => !item.expanded)) {
          assert.ok(
            !intersects(rectangle, node),
            `${id}/${scene.id}: label ${connection.id} overlaps ${node.id}`
          );
        }
        for (const other of labels)
          assert.ok(
            !intersects(rectangle, other),
            `${id}/${scene.id}: labels ${connection.id}/${other.id} overlap`
          );
        labels.push(rectangle);
      }
    }
  }
});

test('focus preserves authored containment and inventories exact crossing relationships', async () => {
  const before = structuredClone(model);
  const focused = project(model, { ...state, expanded: ['core'], scope: 'core' });
  assert.deepEqual(
    focused.elements.map((node) => node.id),
    ['core', 'worker', 'store']
  );
  assert.equal(focused.elements[0].parent, null);
  assert.deepEqual(
    focused.edges.map((connection) => connection.id),
    ['d']
  );
  assert.deepEqual(
    focused.outside?.map((connection) => connection.id),
    ['a', 'b', 'c']
  );
  assert.deepEqual(focused.outside?.[0], model.relationships[0]);
  const nested = project(model, { ...state, scope: 'worker' });
  assert.deepEqual(
    nested.elements.map((node) => [node.id, node.parent]),
    [['worker', null]]
  );
  assert.deepEqual(
    nested.outside?.map((connection) => connection.id),
    ['a', 'c', 'd']
  );
  assert.deepEqual(model, before, 'focus must not mutate authored containment or relationships');
  const diagram = await layout(model, { ...state, expanded: ['core'], scope: 'core' });
  assert.deepEqual(diagram.outside, focused.outside);
  assert.match(exportSvg(model, diagram), /FOCUS: core · 3 external connections outside view/);
});

test('focus crossing inventory applies proposal filtering at relationships and endpoints', () => {
  const proposed = project(model, { ...state, scope: 'worker', proposed: true });
  assert.deepEqual(
    proposed.outside?.map((connection) => connection.id),
    ['a', 'c', 'd', 'e']
  );
  const withProposedEndpoint = {
    ...model,
    relationships: [...model.relationships, edge('future-link', 'worker', 'future')]
  };
  assert.ok(
    !project(withProposedEndpoint, { ...state, scope: 'worker' }).outside?.some(
      (item) => item.id === 'future-link'
    )
  );
  assert.ok(
    project(withProposedEndpoint, { ...state, proposed: true, scope: 'worker' }).outside?.some(
      (item) => item.id === 'future-link'
    )
  );
  assert.throws(() => project(model, { ...state, scope: 'missing' }), /Unknown scope/);
  assert.throws(() => project(model, { ...state, scope: 'future' }), /hidden by proposal filter/);
});

test('node typography reserves right-side controls and keeps long kinds inside the card', async () => {
  const custom = {
    ...model,
    elements: model.elements.map((item) =>
      item.id === 'worker'
        ? {
            ...item,
            title: 'A long component title with a stable identity',
            kind: 'extremely_long_adapter_classification_with_many_words'
          }
        : item
    )
  };
  const diagram = await layout(custom, { ...state, scope: 'worker' });
  const node = diagram.nodes[0];
  assert.ok(
    node.titleLines.every(
      (line) => textWidth(line, METRICS.titleSize) <= node.width - METRICS.expandedTitleWidthInset
    )
  );
  // The kind is an icon with a readable tooltip now, so the label is never truncated.
  assert.equal(node.kindLabel, 'Extremely long adapter classification with many words');
  assert.equal(node.kind, custom.elements.find((item) => item.id === 'worker')!.kind);
});

test('slide export bounds long headings, footer and many boundary legends without losing source text', async () => {
  const longTitle = 'A deliberately extensive architecture proposal heading '.repeat(30);
  const longSubtitle =
    'A detailed explanation of the system and its important responsibilities. '.repeat(100);
  const largeModel = {
    ...model,
    title: longTitle,
    description: longSubtitle,
    boundaries: Array.from({ length: 40 }, (_, i) => ({
      id: `boundary-${i}`,
      title: `Boundary ${i} ${'long explanatory boundary label '.repeat(8)}`,
      description: '',
      kind: 'trust',
      members: ['worker'],
      color: '#739886'
    }))
  };
  const diagram = await layout(largeModel, {
    ...state,
    scope: 'core',
    expanded: ['core'],
    lens: 'trust'
  });
  const svg = exportSvg(largeModel, diagram, { title: longTitle, subtitle: longSubtitle });
  const layer = (name: string): string =>
    svg.match(new RegExp(`<g data-export-layer="${name}">([\\s\\S]*?)</g>`))![1];
  const title = layer('title');
  const subtitle = layer('subtitle');
  assert.equal((title.match(/<tspan/g) ?? []).length, 2);
  assert.equal((subtitle.match(/<tspan/g) ?? []).length, 3);
  assert.match(title, /…<\/tspan>/);
  assert.match(subtitle, /…<\/tspan>/);
  assert.ok(
    svg.includes(`<title id="title">${longTitle}</title>`),
    'full title remains accessible'
  );
  assert.ok(svg.includes(longSubtitle), 'full subtitle remains accessible');
  const legend = layer('legend');
  const entries = [...legend.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)];
  assert.equal(new Set(entries.map((entry) => entry[2])).size, 2);
  for (const entry of entries) {
    assert.ok(Number(entry[1]) >= 96 && Number(entry[1]) + textWidth(entry[3], 14) <= 1824);
    assert.ok(Number(entry[2]) <= 986);
  }
  const malicious = exportSvg(largeModel, diagram, {
    title: '<script>alert("unsafe")</script>',
    subtitle: '<image href="external" />'
  });
  assert.ok(!malicious.includes('<script>') && !malicious.includes('<image href='));
  assert.match(malicious, /&lt;script&gt;/);
  const footerModel = {
    ...largeModel,
    elements: largeModel.elements.map((item) =>
      item.id === 'core' ? { ...item, title: longTitle } : item
    )
  };
  const footerDiagram = await layout(footerModel, { ...state, scope: 'core', expanded: ['core'] });
  const footerSvg = exportSvg(footerModel, footerDiagram);
  const footer = footerSvg.match(/<text x="1824" y="1044"[^>]*>([^<]*)<\/text>/)![1];
  assert.ok(textWidth(footer, 13) <= 860);
  assert.match(footer, /… · 3 external connections outside view$/);
  const remaining = Number(legend.match(/\+(\d+) more boundaries/)![1]);
  assert.equal(entries.length - 1 + remaining, largeModel.boundaries.length);
  const transform = svg.match(
    /data-export-layer="diagram" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)"/
  )!;
  const [tx, ty, scale] = transform.slice(1).map(Number);
  for (const node of diagram.nodes) {
    const extent =
      largeModel.boundaries.filter((boundary) => boundary.members.includes(node.id)).length * 4 + 1;
    assert.ok(tx + (node.x - extent) * scale >= 95);
    assert.ok(tx + (node.x + node.width + extent) * scale <= 1825);
    assert.ok(ty + (node.y - extent) * scale >= 315, 'graph stays below bounded header');
    assert.ok(ty + (node.y + node.height + extent) * scale <= 921, 'graph stays above legend');
  }
});

test('expanded titles use final compound width while preserving control space', async () => {
  const titled = {
    ...model,
    elements: model.elements.map((item) =>
      item.id === 'core' ? { ...item, title: 'Delivery Operations' } : item
    )
  };
  const diagram = await layout(titled, { ...state, expanded: ['core'], scope: 'core' });
  const core = diagram.nodes.find((node) => node.id === 'core')!;
  assert.deepEqual(core.titleLines, ['Delivery Operations']);
  assert.ok(textWidth(core.titleLines[0], 17) <= core.width - 76);
});
