import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { generateFixtures, writeFixtures } from '../scripts/bench-fixtures';
import { DEFAULT_COMPOSITION_LIMITS, type CompositionLimits } from '../src/lib/composition/limits';
import type { ViewState } from '../src/lib/core/types';
import { createCache, createCachePool, serverCachePool } from '../src/lib/server/cache';
import {
  BudgetExceededError,
  composeFromSelector,
  compositionCacheStats,
  effectiveLimits,
  getCompositionStats,
  resetCompositionState,
  submitCompositionRender
} from '../src/lib/server/composition';
import {
  invalidateProject,
  listModels,
  loadDirectory,
  modelCacheStats,
  snapshotOf
} from '../src/lib/server/models';
import { exportLinkedDocument } from '../src/lib/adapters/html';
import { createWorkQueue, QueueFullError } from '../src/lib/server/queue';
import { renderCacheStats, renderDiagram } from '../src/lib/server/render';

const FIXTURES = 'tests/fixtures/linked-projects';
const STATE: ViewState = { expanded: [], proposed: false, lens: 'structure' };

/** A catalog with a healthy host, a healthy plugin and a deliberately missing entry. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fractal-limits-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') },
        { id: 'missing-plugin', directory: join(root, 'missing-plugin') }
      ]
    })
  );
  return { root, catalog, options: { catalog, env: {}, home: join(root, 'home'), cwd: root } };
}

function cold() {
  resetCompositionState();
}

test('a stricter limit after a default render is refused, and the cached view survives', async () => {
  const { root, options } = await fixture();
  cold();
  try {
    const first = await composeFromSelector('host', { composition: 'plugins' }, options);
    const strict = { ...DEFAULT_COMPOSITION_LIMITS, projects: 1 };
    await assert.rejects(
      composeFromSelector('host', { composition: 'plugins' }, { ...options, limits: strict }),
      (error: unknown) => {
        assert.ok(error instanceof BudgetExceededError);
        assert.deepEqual(error.diagnostics[0].budget, {
          resource: 'projects',
          actual: 2,
          limit: 1
        });
        return true;
      }
    );
    // Limits join the cache key, so the cached default result is not served to the strict
    // call — and the refusal stores nothing, so the previous view is retained whole.
    const before = compositionCacheStats();
    const second = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.deepEqual(second, first);
    assert.equal(compositionCacheStats().hits, before.hits + 1);
    assert.equal(getCompositionStats().rejected.overLimit, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('effectiveLimits reads service configuration, never request input', async () => {
  const previous = process.env.FRACTAL_COMPOSITION_LIMITS;
  try {
    delete process.env.FRACTAL_COMPOSITION_LIMITS;
    assert.deepEqual(effectiveLimits({}), DEFAULT_COMPOSITION_LIMITS);

    const env = { FRACTAL_COMPOSITION_LIMITS: '{"projects": 7, "cacheBytes": 1024}' };
    const partial = effectiveLimits({ env });
    assert.equal(partial.projects, 7);
    assert.equal(partial.cacheBytes, 1024);
    assert.equal(partial.loadedElements, DEFAULT_COMPOSITION_LIMITS.loadedElements);
    // One environment object parses once.
    assert.equal(effectiveLimits({ env }), partial);

    // An explicit service/CLI override wins over the environment.
    const explicit = { ...DEFAULT_COMPOSITION_LIMITS, projects: 3 };
    assert.equal(effectiveLimits({ limits: explicit, env }), explicit);

    for (const bad of [
      'not json',
      '[1]',
      '{"projects": "many"}',
      '{"projects": -1}',
      '{"ghost": 1}'
    ])
      assert.throws(() => effectiveLimits({ env: { FRACTAL_COMPOSITION_LIMITS: bad } }));
  } finally {
    if (previous === undefined) delete process.env.FRACTAL_COMPOSITION_LIMITS;
    else process.env.FRACTAL_COMPOSITION_LIMITS = previous;
  }
});

test('byte-bounded caches evict least-recently-used first and report bytes', async () => {
  const cache = createCache<string>(2, { maxBytes: 10, sizeOf: (value) => value.length });
  cache.set('a', '12345');
  cache.set('b', '12345');
  assert.deepEqual(cache.snapshot(), {
    hits: 0,
    misses: 0,
    evictions: 0,
    entries: 2,
    bytes: 10,
    size: 2
  });
  assert.equal(cache.get('a'), '12345');
  cache.set('c', '12345');
  assert.equal(cache.snapshot().evictions, 1);
  assert.equal(cache.get('b'), undefined, 'the least-recently-used entry is evicted first');
  assert.equal(cache.get('a'), '12345');
  assert.equal(cache.get('c'), '12345');
  assert.equal(cache.bytes, 10);
});

test('the shared pool evicts composed results before parsed models', async () => {
  const pool = createCachePool(12);
  const layouts = createCache<string>(10, {
    maxBytes: 1024,
    sizeOf: (value) => value.length,
    pool,
    priority: 1
  });
  const models = createCache<string>(10, {
    maxBytes: 1024,
    sizeOf: (value) => value.length,
    pool,
    priority: 2
  });
  const composed = createCache<string>(10, {
    maxBytes: 1024,
    sizeOf: (value) => value.length,
    pool,
    priority: 0
  });
  models.set('model', '12345678', { tags: ['plugin'] });
  layouts.set('layout', '1234', { tags: ['plugin'] });
  // The composed result overflows the shared bound; the pool evicts it before older entries
  // in higher-priority caches.
  composed.set('result', '12345678', { tags: ['plugin'] });
  assert.equal(pool.bytes <= 12, true);
  assert.equal(composed.size, 0);
  assert.equal(models.size, 1);
  assert.equal(layouts.size, 1);
  assert.equal(pool.invalidateTags(['plugin']), 2);
  assert.equal(models.size, 0);
  assert.equal(layouts.size, 0);
});

test('the retained-bytes pool follows the configured cacheBytes', async () => {
  const previous = process.env.FRACTAL_COMPOSITION_LIMITS;
  try {
    resetCompositionState();
    process.env.FRACTAL_COMPOSITION_LIMITS = '{"cacheBytes": 1048576}';
    const configured = getCompositionStats();
    assert.equal(configured.limits.cacheBytes, 1048576);
    assert.equal(serverCachePool.maxBytes, 1048576);

    // A per-request override governs admission only; the process-wide pool stays put.
    const { root, options } = await fixture();
    try {
      await composeFromSelector(
        'host',
        { composition: 'plugins' },
        { ...options, limits: { ...DEFAULT_COMPOSITION_LIMITS, cacheBytes: 256 * 1024 * 1024 } }
      );
      assert.equal(serverCachePool.maxBytes, 1048576);
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    delete process.env.FRACTAL_COMPOSITION_LIMITS;
    resetCompositionState();
    getCompositionStats();
    assert.equal(serverCachePool.maxBytes, 128 * 1024 * 1024);
  } finally {
    if (previous === undefined) delete process.env.FRACTAL_COMPOSITION_LIMITS;
    else process.env.FRACTAL_COMPOSITION_LIMITS = previous;
    resetCompositionState();
    getCompositionStats();
  }
});

test('editing one target invalidates its layouts while unrelated projects survive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-invalidation-'));
  const ids = ['proj-a', 'proj-b', 'proj-c'];
  try {
    for (const id of ids) {
      const directory = join(root, id);
      await cp('examples/delivery', directory, { recursive: true });
      const companion = JSON.parse(await readFile(join(directory, 'fractal.json'), 'utf8'));
      companion.id = id;
      companion.title = id;
      await writeFile(join(directory, 'fractal.json'), JSON.stringify(companion, null, 2));
    }
    cold();
    const loaded = new Map<string, Awaited<ReturnType<typeof loadDirectory>>>();
    for (const id of ids) loaded.set(id, await loadDirectory(join(root, id)));
    assert.equal(modelCacheStats().misses, 3);
    for (const id of ids) await renderDiagram(loaded.get(id)!, STATE);
    assert.equal(renderCacheStats().entries, 3);
    for (const id of ids) await renderDiagram(loaded.get(id)!, STATE);
    assert.equal(renderCacheStats().hits, 3);

    // Editing proj-b reparses it and drops exactly its layout entry.
    await appendFile(join(root, 'proj-b', 'model.c4'), '\n// an authored note\n');
    const reb = await loadDirectory(join(root, 'proj-b'));
    assert.notEqual(reb.revision, loaded.get('proj-b')!.revision);
    assert.equal(renderCacheStats().entries, 2);
    assert.equal(modelCacheStats().entries, 3, 'the stale parse is purged, not leaked');

    const hits = renderCacheStats().hits;
    await renderDiagram(loaded.get('proj-a')!, STATE);
    await renderDiagram(loaded.get('proj-c')!, STATE);
    assert.equal(renderCacheStats().hits, hits + 2, 'unrelated layouts survive');
    const misses = renderCacheStats().misses;
    await renderDiagram(reb, STATE);
    assert.equal(renderCacheStats().misses, misses + 1, 'the edited target lays out again');
    assert.equal(renderCacheStats().entries, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('editing a linked target invalidates every composed result that included it', async () => {
  const { root, options } = await fixture();
  const models = join(root, 'models');
  cold();
  try {
    const first = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.equal(compositionCacheStats().entries, 1);

    await appendFile(join(models, 'plugin', 'model.c4'), '\n// an authored note\n');
    await loadDirectory(join(models, 'plugin'));
    assert.equal(compositionCacheStats().entries, 0, 'the composed result is dropped');

    const second = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.equal(compositionCacheStats().entries, 1);
    assert.notEqual(second.revisions.plugin, first.revisions.plugin);
    assert.equal(second.revisions.host, first.revisions.host);

    // Explicit invalidation names what it removed: the host parse and the composition.
    assert.equal(invalidateProject('host', join(models, 'host')), 2);
    assert.equal(compositionCacheStats().entries, 0);
    const hits = modelCacheStats().hits;
    await loadDirectory(join(models, 'plugin'));
    assert.equal(modelCacheStats().hits, hits + 1, 'the unrelated parse survives');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((done) => setImmediate(done));
};

test('the queue runs at most two jobs at once', async () => {
  const queue = createWorkQueue({ concurrency: 2 });
  let running = 0;
  let maxSeen = 0;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const work = async () => {
    running += 1;
    maxSeen = Math.max(maxSeen, running);
    await gate;
    running -= 1;
    return 'done';
  };
  const pending = [
    queue.submit('root', 'a', work),
    queue.submit('root', 'b', work),
    queue.submit('root', 'c', work),
    queue.submit('root', 'd', work)
  ];
  await flush();
  assert.equal(maxSeen, 2, 'only two jobs run while two wait');
  assert.deepEqual(queue.snapshot(), { active: 2, queued: 2, completed: 0, coalesced: 0 });
  release();
  const outcomes = await Promise.all(pending);
  assert.ok(outcomes.every((outcome) => outcome.status === 'ready' && !outcome.coalesced));
  assert.equal(queue.snapshot().completed, 4);
});

test('identical in-flight requests share one promise', async () => {
  const queue = createWorkQueue({ concurrency: 2 });
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const work = async () => {
    calls += 1;
    await gate;
    return 'shared';
  };
  const first = queue.submit('root', 'same', work);
  const second = queue.submit('root', 'same', work);
  await flush();
  assert.equal(calls, 1, 'the second request coalesces instead of working');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 'ready');
  assert.equal(b.status, 'ready');
  if (a.status !== 'ready' || b.status !== 'ready') throw new Error('expected ready outcomes');
  assert.equal(a.result, 'shared');
  assert.equal(b.result, 'shared');
  assert.equal(a.coalesced, false);
  assert.equal(b.coalesced, true);
  assert.equal(queue.snapshot().coalesced, 1);
});

test('an older generation is answered stale without doing work', async () => {
  const queue = createWorkQueue({ concurrency: 2 });
  let calls = 0;
  const ready = await queue.submit(
    'root',
    'a',
    async () => {
      calls += 1;
      return 'new';
    },
    { generation: 2, client: 'tab-a' }
  );
  assert.equal(ready.status, 'ready');
  const stale = await queue.submit(
    'root',
    'b',
    async () => {
      calls += 1;
      return 'old';
    },
    { generation: 1, client: 'tab-a' }
  );
  assert.deepEqual(stale, { status: 'stale', generation: 1, current: 2 });
  assert.equal(calls, 1, 'the superseded request never runs');
  // Unrelated roots keep their own generation.
  const other = await queue.submit('other', 'b', async () => 'other', {
    generation: 1,
    client: 'tab-a'
  });
  assert.equal(other.status, 'ready');
});

test('without a client id the queue never answers stale', async () => {
  const queue = createWorkQueue({ concurrency: 2 });
  let calls = 0;
  const first = await queue.submit(
    'root',
    'a',
    async () => {
      calls += 1;
      return 'new';
    },
    { generation: 5 }
  );
  const second = await queue.submit(
    'root',
    'b',
    async () => {
      calls += 1;
      return 'old';
    },
    { generation: 1 }
  );
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.equal(calls, 2, 'an anonymous older generation still runs');
});

test('two clients keep independent generation counters', async () => {
  const queue = createWorkQueue({ concurrency: 2 });
  let calls = 0;
  const work = async () => {
    calls += 1;
    return 'ok';
  };
  const aNew = await queue.submit('root', 'a', work, { generation: 5, client: 'tab-a' });
  const aOld = await queue.submit('root', 'b', work, { generation: 1, client: 'tab-a' });
  const bFirst = await queue.submit('root', 'c', work, { generation: 1, client: 'tab-b' });
  assert.equal(aNew.status, 'ready');
  assert.deepEqual(aOld, { status: 'stale', generation: 1, current: 5 });
  assert.equal(bFirst.status, 'ready', 'another tab is not staled by the first tab');
  assert.equal(calls, 2);
});

test('a request superseded while queued goes stale', async () => {
  const queue = createWorkQueue({ concurrency: 1 });
  const ran: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const occupying = queue.submit(
    'root',
    'slow',
    async () => {
      ran.push('slow');
      await gate;
      return 'slow';
    },
    { generation: 5, client: 'tab-a' }
  );
  const superseded = queue.submit(
    'root',
    'queued',
    async () => {
      ran.push('queued');
      return 'queued';
    },
    { generation: 6, client: 'tab-a' }
  );
  const newer = queue.submit(
    'root',
    'newer',
    async () => {
      ran.push('newer');
      return 'newer';
    },
    { generation: 7, client: 'tab-a' }
  );
  await flush();
  release();
  assert.equal((await occupying).status, 'ready');
  assert.deepEqual(await superseded, { status: 'stale', generation: 6, current: 7 });
  const fresh = await newer;
  assert.equal(fresh.status, 'ready');
  assert.deepEqual(ran, ['slow', 'newer'], 'the superseded request never runs');
});

test('a newer request coalesced onto a superseded job still runs', async () => {
  const queue = createWorkQueue({ concurrency: 1 });
  const ran: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const oldest = queue.submit(
    'root',
    'other',
    async () => {
      ran.push('gen1');
      await gate;
      return 'gen1';
    },
    { generation: 1, client: 'tab-a' }
  );
  const superseded = queue.submit(
    'root',
    'same',
    async () => {
      ran.push('gen2');
      return 'gen2';
    },
    { generation: 2, client: 'tab-a' }
  );
  // Same key as the queued gen2 job: coalesces instead of queueing separately.
  const newest = queue.submit(
    'root',
    'same',
    async () => {
      ran.push('gen3');
      return 'gen3';
    },
    { generation: 3, client: 'tab-a' }
  );
  await flush();
  release();
  assert.equal((await oldest).status, 'ready');
  assert.deepEqual(await superseded, { status: 'stale', generation: 2, current: 3 });
  const fresh = await newest;
  assert.equal(fresh.status, 'ready');
  if (fresh.status !== 'ready') throw new Error('expected the newest request to run');
  assert.equal(fresh.result, 'gen3');
  assert.deepEqual(ran, ['gen1', 'gen3'], 'the newest request runs instead of inheriting stale');
});

test('a full queue refuses with server_busy', async () => {
  const queue = createWorkQueue({ concurrency: 1, maxWaiting: 1 });
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const work = async () => {
    await gate;
    return 'done';
  };
  const occupying = queue.submit('root', 'a', work);
  const waiting = queue.submit('root', 'b', work);
  await assert.rejects(queue.submit('root', 'c', work), QueueFullError);
  release();
  assert.equal((await occupying).status, 'ready');
  assert.equal((await waiting).status, 'ready');
});

test('submitCompositionRender counts stale generations as rejected work', async () => {
  const { root, options } = await fixture();
  cold();
  try {
    const first = await submitCompositionRender(
      'host',
      { composition: 'plugins' },
      { ...options, generation: 5, client: 'tab-a' }
    );
    assert.equal(first.status, 'ready');
    if (first.status !== 'ready') throw new Error('expected a ready render');
    assert.equal(first.coalesced, false);
    assert.deepEqual(Object.keys(first.result.revisions).sort(), ['host', 'plugin']);

    const superseded = await submitCompositionRender(
      'host',
      { composition: 'plugins' },
      { ...options, generation: 3, client: 'tab-a' }
    );
    assert.deepEqual(superseded, { status: 'stale', generation: 3, current: 5 });
    assert.equal(getCompositionStats().rejected.stale, 1);

    const other = await submitCompositionRender(
      'host',
      { composition: 'plugins' },
      { ...options, generation: 1, client: 'tab-b' }
    );
    assert.equal(other.status, 'ready', 'a second client is not staled by the first');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent renders echo each caller generation', async () => {
  const { root, options } = await fixture();
  cold();
  try {
    const [five, six] = await Promise.all([
      submitCompositionRender('host', { composition: 'plugins' }, { ...options, generation: 5 }),
      submitCompositionRender('host', { composition: 'plugins' }, { ...options, generation: 6 })
    ]);
    assert.equal(five.status, 'ready');
    assert.equal(six.status, 'ready');
    if (five.status !== 'ready' || six.status !== 'ready')
      throw new Error('expected ready renders');
    assert.equal(five.result.generation, 5);
    assert.equal(six.result.generation, 6, 'a coalesced caller gets its own generation');
    assert.deepEqual(
      { ...five.result, generation: undefined },
      { ...six.result, generation: undefined },
      'both callers share the same content'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cold startup with 20 unopened links performs zero foreign parses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fractal-cold-'));
  try {
    const generated = generateFixtures(['unopened']);
    const written = await writeFixtures(generated, directory);
    const options = {
      catalog: written.catalog,
      env: {},
      home: join(directory, 'home'),
      cwd: directory
    };
    cold();
    // Listing models reads companion metadata only: no model is compiled.
    const models = await listModels(options);
    assert.equal(models.length, 21);
    assert.equal(modelCacheStats().misses, 0, 'listing models parses nothing');

    // Rendering the root resolves and parses the root alone; the 20 linked targets stay
    // untouched until one is explicitly opened.
    const result = await composeFromSelector('unopened-hub', { composition: 'root-only' }, options);
    assert.deepEqual(
      result.composed.projects.map((project) => project.model),
      ['unopened-hub']
    );
    assert.equal(modelCacheStats().misses, 1, 'only the root is parsed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stats report caches, queue, rejected work and the configured limits', async () => {
  const { root, options } = await fixture();
  const previous = process.env.FRACTAL_COMPOSITION_LIMITS;
  cold();
  try {
    delete process.env.FRACTAL_COMPOSITION_LIMITS;
    await composeFromSelector('host', { composition: 'plugins' }, options);
    const stats = getCompositionStats();
    assert.equal(stats.version, 1);
    assert.deepEqual(stats.limits, DEFAULT_COMPOSITION_LIMITS);
    for (const cache of [stats.caches.models, stats.caches.layouts, stats.caches.composed]) {
      for (const field of ['hits', 'misses', 'entries', 'bytes', 'evictions'] as const)
        assert.equal(typeof cache[field], 'number', `caches carry ${field}`);
    }
    assert.ok(stats.caches.models.entries >= 2, 'both parses are retained');
    assert.ok(stats.caches.composed.entries >= 1, 'the composed result is retained');
    assert.deepEqual(Object.keys(stats.queue).sort(), [
      'active',
      'coalesced',
      'completed',
      'queued'
    ]);
    assert.deepEqual(stats.rejected, { stale: 0, overLimit: 0 });
  } finally {
    if (previous === undefined) delete process.env.FRACTAL_COMPOSITION_LIMITS;
    else process.env.FRACTAL_COMPOSITION_LIMITS = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('composition-stats and an over-limit CLI composition report honestly', async () => {
  const { root, catalog } = await fixture();
  try {
    const run = (args: string[], env: NodeJS.ProcessEnv = {}) => {
      const result = spawnSync(resolve('bin/fractal'), args, {
        encoding: 'utf8',
        // An empty override means defaults, so ambient service configuration cannot skew
        // the stats assertion; per-call entries still win when a test sets them.
        env: {
          ...process.env,
          FRACTAL_CATALOG: catalog,
          FRACTAL_COMPOSITION_LIMITS: '',
          ...env
        }
      });
      return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    };
    const stats = run(['composition-stats', '--json']);
    assert.equal(stats.status, 0);
    const reported = JSON.parse(stats.stdout);
    assert.equal(reported.version, 1);
    assert.deepEqual(reported.limits, DEFAULT_COMPOSITION_LIMITS);
    assert.ok(reported.caches.models);

    const refused = run(['layout', '--model', 'host', '--composition', 'plugins', '--json'], {
      FRACTAL_COMPOSITION_LIMITS: '{"projects": 1}'
    });
    assert.equal(refused.status, 1, 'an over-limit composition exits nonzero');
    const body = JSON.parse(refused.stderr);
    assert.equal(body.code, 'budget_exceeded');
    assert.equal(body.diagnostics[0].budget.resource, 'projects');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const linkedAssets = { js: '/* reader */', css: '/* css */' };

async function linkedSnapshots(root: string) {
  const models = join(root, 'models');
  const host = await loadDirectory(join(models, 'host'));
  const plugin = await loadDirectory(join(models, 'plugin'));
  return { host, plugin };
}

function linkedExportOptions(
  host: Awaited<ReturnType<typeof loadDirectory>>,
  plugin: Awaited<ReturnType<typeof loadDirectory>>,
  limits?: CompositionLimits
) {
  return {
    state: host.model.scenes[0],
    scene: 'overview',
    sequences: host.sequences,
    assets: linkedAssets,
    include: ['plugin'],
    snapshots: [snapshotOf(host), snapshotOf(plugin)],
    sequencesByModel: { host: host.sequences, plugin: plugin.sequences },
    ...(limits === undefined ? {} : { limits })
  };
}

test("linked HTML export shares the admission gate with svg and png (format: 'html')", async () => {
  const { root } = await fixture();
  cold();
  try {
    const { host, plugin } = await linkedSnapshots(root);
    // Defaults admit the two-project document.
    const allowed = await exportLinkedDocument(
      host.model,
      linkedExportOptions(host, plugin, { ...DEFAULT_COMPOSITION_LIMITS })
    );
    assert.deepEqual(
      allowed.document.snapshots.map((snapshot) => snapshot.id),
      ['host', 'plugin']
    );
    // A stricter project budget refuses the same document whole, like the other formats.
    await assert.rejects(
      exportLinkedDocument(
        host.model,
        linkedExportOptions(host, plugin, { ...DEFAULT_COMPOSITION_LIMITS, projects: 1 })
      ),
      (error: unknown) => {
        assert.ok(error instanceof BudgetExceededError);
        assert.deepEqual(error.diagnostics[0].budget, {
          resource: 'projects',
          actual: 2,
          limit: 1
        });
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('visible counts include bridges, ports and stubs toward the visible gates', async () => {
  const { root, options } = await fixture();
  cold();
  try {
    const { composed } = await composeFromSelector('host', { composition: 'plugins' }, options);
    let localNodes = 0;
    let localEdges = 0;
    let ports = 0;
    for (const project of composed.projects) {
      localNodes += project.diagram?.nodes.length ?? 0;
      localEdges += project.diagram?.edges.length ?? 0;
      ports += project.ports.length;
    }
    assert.ok(composed.bridges.length > 0, 'the fixture draws bridges');
    assert.ok(composed.stubs.length > 0, 'the fixture leaves reference stubs');
    // Bridges count as visible edges on top of the local diagrams.
    await assert.rejects(
      composeFromSelector(
        'host',
        { composition: 'plugins' },
        { ...options, limits: { ...DEFAULT_COMPOSITION_LIMITS, visibleEdges: localEdges } }
      ),
      (error: unknown) => {
        assert.ok(error instanceof BudgetExceededError);
        assert.deepEqual(error.diagnostics[0].budget, {
          resource: 'visible_edges',
          actual: localEdges + composed.bridges.length,
          limit: localEdges
        });
        return true;
      }
    );
    // Ports and stubs count as visible nodes on top of the local diagrams.
    await assert.rejects(
      composeFromSelector(
        'host',
        { composition: 'plugins' },
        { ...options, limits: { ...DEFAULT_COMPOSITION_LIMITS, visibleNodes: localNodes } }
      ),
      (error: unknown) => {
        assert.ok(error instanceof BudgetExceededError);
        assert.deepEqual(error.diagnostics[0].budget, {
          resource: 'visible_nodes',
          actual: localNodes + ports + composed.stubs.length,
          limit: localNodes
        });
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
