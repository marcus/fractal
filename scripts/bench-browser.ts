#!/usr/bin/env node
// Browser-side proof for the layout work: what a reader actually waits for. Opens the studio,
// records the page-open request waterfall, and times click-to-geometry for one expand, one
// collapse and show-all, with frame timing and long tasks during each; then does the same
// toggles in a freshly exported portable document. Toggle latency is the headline number.
// Prints JSON. This is a proof tool, not part of CI.
import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { access, cp, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { percentile } from '../src/lib/bench';
import { loadDirectory, resolveCatalog } from '../src/lib/server/models';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Fractal · browser layout benchmark

Usage: npm run bench:browser -- [options]

Measures click-to-geometry latency in a real browser: one expand, one collapse and show-all in
the studio, then the same toggles in a portable HTML document. Prints one JSON document.

Options:
  --url URL        Measure a studio already running at this URL
  --model ID       Model to open (default: the largest model in the resolved catalog)
  --skip-build     Reuse an existing build/ instead of running npm run build
  --keep-portable  Leave the exported portable document on disk and report its path
  --composition    Run the linked composition journey against a private temp catalog:
                   cold startup with zero foreign fetches, open a link, expand the target,
                   pan/zoom, then --cycles open/close cycles with retained heap growth
  --cycles N       Open/close cycles in the composition journey (default 50)
  --pan-ms N       Pan/zoom sampling window in milliseconds (default 3000)
  -h, --help       Show this text`;

/**
 * Installed before any page script so the long-task observer sees the first paint, and so the
 * measurement survives navigation. Written as a plain string: tsx's helpers do not exist in the
 * page, and a compiled function body would reference them.
 */
const INIT_SCRIPT = `
window.__bench = {
  longTasks: [],
  signature() {
    var nodes = document.querySelectorAll('[data-node-id]');
    var parts = [];
    for (var i = 0; i < nodes.length; i++)
      parts.push(nodes[i].getAttribute('data-node-id') + '@' + nodes[i].getAttribute('transform'));
    return parts.join('|');
  },
  /**
   * Samples frame deltas and long tasks over a fixed window, for gestures (pan/zoom) that do not
   * change node transforms and so never move the geometry signature.
   */
  sample(windowMs) {
    var started = performance.now();
    var taskCount = window.__bench.longTasks.length;
    var frames = [];
    var last = started;
    return new Promise(function (resolve) {
      var tick = function () {
        var now = performance.now();
        frames.push(now - last);
        last = now;
        if (now - started > windowMs) {
          resolve({
            latencyMs: null,
            frames: frames,
            longTasks: window.__bench.longTasks.slice(taskCount)
          });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  },
  /** Chromium's heap counters, when precise memory info is enabled. */
  memory() {
    var memory = performance.memory;
    if (!memory) return null;
    return { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize };
  },
  /** Called before a heap reading when Chromium was launched with --expose-gc. */
  collectGarbage() {
    if (typeof window.gc === 'function') window.gc();
    return true;
  },
  /**
   * Resolves when the diagram's geometry differs from the signature taken now, timed from the
   * click that caused it. Frame deltas and long tasks are collected over the same window.
   */
  watch(settleMs, timeoutMs) {
    var before = window.__bench.signature();
    var taskCount = window.__bench.longTasks.length;
    var opened = performance.now();
    var start = null;
    var latency = null;
    var frames = [];
    var last = opened;
    var onClick = function () {
      start = performance.now();
      document.removeEventListener('click', onClick, true);
    };
    document.addEventListener('click', onClick, true);
    return new Promise(function (resolve) {
      var tick = function () {
        var now = performance.now();
        if (start !== null) frames.push(now - last);
        last = now;
        if (start !== null && latency === null && window.__bench.signature() !== before)
          latency = now - start;
        var done = latency !== null && now - start > settleMs;
        if (done || now - opened > timeoutMs) {
          document.removeEventListener('click', onClick, true);
          resolve({
            latencyMs: latency,
            frames: frames,
            longTasks: window.__bench.longTasks.slice(taskCount)
          });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
};
try {
  new PerformanceObserver(function (list) {
    var entries = list.getEntries();
    for (var i = 0; i < entries.length; i++)
      window.__bench.longTasks.push({
        startMs: entries[i].startTime,
        durationMs: entries[i].duration
      });
  }).observe({ entryTypes: ['longtask'] });
} catch (error) {
  /* Long tasks are unavailable outside Chromium; the rest of the measurement still holds. */
}
`;

interface FrameStats {
  p50: number;
  p99: number;
  count: number;
}
interface ToggleResult {
  target: string;
  latencyMs: number | null;
  frames: FrameStats;
  longTasks: { startMs: number; durationMs: number }[];
  longTaskTotalMs: number;
  dom?: { nodes: number; edges: number; elements: number };
}
interface RawWatch {
  latencyMs: number | null;
  frames: number[];
  longTasks: { startMs: number; durationMs: number }[];
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The same nearest-rank percentile the stage timings use, so both benchmarks read alike. */
const frameTime = (values: readonly number[], fraction: number): number =>
  round(percentile(values, fraction));

function summarize(target: string, watch: RawWatch): ToggleResult {
  return {
    target,
    latencyMs: watch.latencyMs === null ? null : round(watch.latencyMs),
    frames: {
      p50: frameTime(watch.frames, 0.5),
      p99: frameTime(watch.frames, 0.99),
      count: watch.frames.length
    },
    longTasks: watch.longTasks.map((task) => ({
      startMs: round(task.startMs),
      durationMs: round(task.durationMs)
    })),
    longTaskTotalMs: round(watch.longTasks.reduce((total, task) => total + task.durationMs, 0))
  };
}

/** Click a control and report what the diagram did, timed from the click event itself. */
async function measureClick(page: Page, selector: string, label: string): Promise<ToggleResult> {
  const control = page.locator(selector).first();
  await control.waitFor({ state: 'attached', timeout: 15000 });
  const watching = page.evaluate('window.__bench.watch(400, 15000)') as Promise<RawWatch>;
  await control.click();
  return { ...summarize(label, await watching), dom: await diagramDom(page) };
}

/** Mounted SVG content, independent of the semantic model's full size. */
async function diagramDom(page: Page) {
  return page.evaluate(() => ({
    nodes: document.querySelectorAll('[data-node-id]').length,
    edges: document.querySelectorAll('[data-edge-id]').length,
    elements: document.querySelectorAll('svg *').length
  }));
}

async function longTasksSoFar(page: Page): Promise<number> {
  return (await page.evaluate('window.__bench.longTasks.length')) as number;
}

/** The studio shows this badge while the server composes a view; it must be gone before timing. */
async function settle(page: Page): Promise<void> {
  await page.locator('[data-node-id]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(
    'document.querySelectorAll(".loading-badge").length === 0',
    undefined,
    { timeout: 30000 }
  );
}

/** The canvas toggle, which both the studio and the portable reader draw; the outline's is separate. */
const EXPAND = '[aria-label^="Expand "]:not([aria-label$="in outline"])';

async function measureToggles(page: Page, showAll: boolean) {
  const expandTarget = await page.locator(EXPAND).first().getAttribute('aria-label');
  if (expandTarget === null) throw new Error('No expandable component on the canvas');
  const expand = await measureClick(page, EXPAND, expandTarget);
  await settle(page);
  // The same control, now labelled for the reverse action, so both toggles are the same component.
  const collapseTarget = expandTarget.replace('Expand ', 'Collapse ');
  const collapse = await measureClick(page, `[aria-label="${collapseTarget}"]`, collapseTarget);
  await settle(page);
  if (!showAll) return { expand, collapse };
  const all = await measureClick(page, 'button[aria-label="Show all structure"]', 'Show all');
  await settle(page);
  return { expand, collapse, showAll: all };
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'inherit']
    });
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    );
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${url}/api/models`);
      if (response.ok) return;
    } catch {
      /* Not listening yet. */
    }
    if (Date.now() > deadline) throw new Error(`Server did not start at ${url}`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

/**
 * The model to open: by default the largest in the resolved catalog, because that is the one a
 * reader waits longest for. A named model may instead be one of the bundled examples, which the
 * catalog does not have to list — the server this script starts is then pointed at the examples
 * so it serves the same model the portable export was taken from.
 */
async function resolveModel(
  requested: string | undefined
): Promise<{ id: string; env: NodeJS.ProcessEnv }> {
  const catalog = await resolveCatalog();
  const sizes = await Promise.all(
    catalog.projects.map(async (project) => {
      const { model } = await loadDirectory(project.directory);
      return { id: project.id, size: model.elements.length };
    })
  );
  if (requested === undefined) {
    if (!sizes.length) throw new Error('No projects in the resolved catalog');
    return { id: sizes.sort((a, b) => b.size - a.size || a.id.localeCompare(b.id))[0].id, env: {} };
  }
  if (sizes.some((entry) => entry.id === requested)) return { id: requested, env: {} };
  const examples = join(ROOT, 'examples');
  if (!(await exists(join(examples, requested, 'model.c4'))))
    throw new Error(`Unknown model: ${requested}`);
  return { id: requested, env: { FRACTAL_CATALOG: '', FRACTAL_MODELS_DIR: examples } };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Studio API requests already completed, named with their path and query. */
async function apiRequests(
  page: Page
): Promise<{ name: string; startMs: number; durationMs: number }[]> {
  return (await page.evaluate(
    `performance.getEntriesByType('resource')
      .filter(function (entry) { return entry.name.indexOf('/api/') >= 0; })
      .map(function (entry) {
        return {
          name: new URL(entry.name).pathname + new URL(entry.name).search,
          startMs: Math.round(entry.startTime * 100) / 100,
          durationMs: Math.round(entry.duration * 100) / 100
        };
      })`
  )) as { name: string; startMs: number; durationMs: number }[];
}

/** Wait until exactly `count` project frames are mounted in the composed canvas. */
async function waitForFrames(page: Page, count: number, timeout = 20000): Promise<void> {
  await page.waitForFunction(
    (expected: number) => document.querySelectorAll('[data-project-frame]').length === expected,
    count,
    { timeout }
  );
}

/** Open the host's linked plugin without the measurement wrapper, for the cycle loop. */
async function openLinked(page: Page): Promise<void> {
  if ((await page.locator('[data-open-link="plugin"]').count()) === 0) {
    await page.locator('[data-node-id="core"]').click();
    await page.getByRole('button', { name: 'Plugin adapter', exact: true }).click();
    await page.locator('[data-open-link="plugin"]').waitFor({ state: 'attached', timeout: 15000 });
  }
  await page.locator('[data-open-link="plugin"]').click();
  await waitForFrames(page, 2);
}

/** Close the linked plugin from its project menu. */
async function closeLinked(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project options: Beacon plugin' }).click();
  await page.getByRole('menuitem', { name: 'Close' }).click();
  await waitForFrames(page, 0);
}

interface HeapReading {
  used: number;
  total: number;
}

/** A heap reading after a collection request; null when the browser exposes no counters. */
async function readHeap(page: Page): Promise<HeapReading | null> {
  await page.evaluate('window.__bench.collectGarbage()');
  return (await page.evaluate('window.__bench.memory()')) as HeapReading | null;
}

interface CompositionJourneyOptions {
  model: string;
  scene: string;
  cycles: number;
  panMs: number;
}

/**
 * The linked composition journey against the real routes: a cold studio startup that fetches the
 * catalog and the root only, an explicit link open, a target expansion, a sustained pan/zoom
 * sample, then repeated open/close cycles with a retained-heap reading where available.
 */
async function compositionJourney(
  url: string,
  options: CompositionJourneyOptions,
  browser: Browser
): Promise<Record<string, unknown>> {
  const context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    reducedMotion: 'reduce'
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const modelRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/models/')) modelRequests.push(new URL(request.url()).pathname);
  });

  const opened = Date.now();
  await page.goto(
    `${url}/?model=${encodeURIComponent(options.model)}&scene=${encodeURIComponent(options.scene)}`,
    { waitUntil: 'load' }
  );
  await settle(page);
  const coldStartupMs = Date.now() - opened;
  const startupRequests = await apiRequests(page);
  const foreignBeforeOpen = modelRequests.filter((path) => /plugin|missing-plugin/.test(path));

  // Listing links must never fetch a foreign model; only the explicit open below may.
  await page.locator('[data-node-id="core"]').click();
  await page.getByRole('button', { name: 'Plugin adapter', exact: true }).click();
  await page
    .getByRole('region', { name: 'Linked diagrams' })
    .waitFor({ state: 'visible', timeout: 15000 });

  const open = await measureClick(page, '[data-open-link="plugin"]', 'open Beacon plugin');
  await waitForFrames(page, 2);
  open.dom = await diagramDom(page);
  const foreignAfterOpen = modelRequests.filter((path) => /plugin|missing-plugin/.test(path));

  const expand = await measureClick(
    page,
    'button[aria-label="Expand Beacon plugin"]',
    'expand Beacon plugin'
  );
  await page.locator('[data-node-id="plugin:cli"]').waitFor({ state: 'visible', timeout: 15000 });
  const domAfterExpand = await diagramDom(page);

  await page.locator('.composition-canvas svg').focus();
  const sampling = page.evaluate(`window.__bench.sample(${options.panMs})`) as Promise<RawWatch>;
  const canvas = (await page.locator('.composition-canvas svg').boundingBox())!;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i % 2 === 0 ? '=' : '-');
    await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.5);
    await page.mouse.wheel(0, i % 2 === 0 ? -160 : 160);
    await page.waitForTimeout(Math.max(20, Math.floor(options.panMs / 12)));
  }
  const panZoom = summarize('pan/zoom', await sampling);

  const heapBefore = await readHeap(page);
  const tasksBeforeCycles = (await page.evaluate('window.__bench.longTasks.length')) as number;
  const cyclesStarted = Date.now();
  for (let i = 0; i < options.cycles; i++) {
    await closeLinked(page);
    await openLinked(page);
  }
  const cyclesWallMs = Date.now() - cyclesStarted;
  const cycleLongTasks = (await page.evaluate(
    `window.__bench.longTasks.slice(${tasksBeforeCycles})`
  )) as { startMs: number; durationMs: number }[];
  const heapAfter = await readHeap(page);

  const longTasksOver50 = [...open.longTasks, ...expand.longTasks, ...panZoom.longTasks].filter(
    (task) => task.durationMs > 50
  );
  const heap =
    heapBefore && heapAfter
      ? {
          supported: true,
          beforeBytes: heapBefore.used,
          afterBytes: heapAfter.used,
          growthBytes: heapAfter.used - heapBefore.used,
          growthPercent:
            heapBefore.used > 0
              ? round(((heapAfter.used - heapBefore.used) / heapBefore.used) * 100)
              : null,
          cycles: options.cycles
        }
      : { supported: false, cycles: options.cycles };

  return {
    journey: {
      coldStartupMs,
      startupRequests,
      foreignModelRequestsBeforeOpen: foreignBeforeOpen,
      foreignModelRequestsAfterOpen: foreignAfterOpen,
      open,
      expand,
      dom: { atOpen: open.dom, afterExpand: domAfterExpand },
      panZoom,
      cycles: {
        count: options.cycles,
        wallMs: cyclesWallMs,
        longTasks: cycleLongTasks,
        heap
      },
      errors
    },
    headline: {
      coldStartupMs,
      openMs: open.latencyMs,
      expandMs: expand.latencyMs,
      frameP99Ms: panZoom.frames.p99,
      longTasksOver50Ms: longTasksOver50.length,
      foreignModelRequestsBeforeOpen: foreignBeforeOpen.length,
      retainedHeapGrowthPercent: heap.supported ? heap.growthPercent : null
    },
    longTasksOver50
  };
}

const COMPOSITION_SCENE = 'overview';

/**
 * Start a private server over an isolated temp catalog holding only the fictional host and plugin
 * fixtures, then run the composition journey. Repository models are never copied or bundled.
 */
async function runCompositionMode(values: {
  model?: string;
  'skip-build'?: boolean;
  cycles: string;
  'pan-ms': string;
}): Promise<void> {
  const cycles = Number(values.cycles);
  if (!Number.isInteger(cycles) || cycles < 1)
    throw new Error('--cycles must be a whole number of at least 1');
  const panMs = Number(values['pan-ms']);
  if (!Number.isFinite(panMs) || panMs < 100)
    throw new Error('--pan-ms must be a whole number of at least 100');
  const directory = await mkdtemp(join(tmpdir(), 'fractal-bench-linked-'));
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  const stop = (code: number) => {
    server?.kill('SIGTERM');
    process.exit(code);
  };
  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(143));
  try {
    const host = join(directory, 'host');
    const plugin = join(directory, 'plugin');
    await cp(join(ROOT, 'tests', 'fixtures', 'linked-projects', 'host'), host, {
      recursive: true
    });
    await cp(join(ROOT, 'tests', 'fixtures', 'linked-projects', 'plugin'), plugin, {
      recursive: true
    });
    const catalog = join(directory, 'catalog.json');
    await writeFile(
      catalog,
      JSON.stringify(
        {
          version: 1,
          projects: [
            { id: 'host', directory: host },
            { id: 'plugin', directory: plugin }
          ]
        },
        null,
        2
      ) + '\n'
    );
    if (!values['skip-build']) await run('npm', ['run', 'build']);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    server = spawn('node', ['build'], {
      cwd: ROOT,
      env: {
        ...process.env,
        FRACTAL_CATALOG: catalog,
        FRACTAL_MODELS_DIR: '',
        PORT: String(port),
        HOST: '127.0.0.1'
      },
      stdio: ['ignore', 'ignore', 'inherit']
    });
    await waitForServer(url, 30000);
    browser = await chromium.launch({
      args: ['--js-flags=--expose-gc', '--enable-precise-memory-info']
    });
    const journey = await compositionJourney(
      url,
      { model: values.model ?? 'host', scene: COMPOSITION_SCENE, cycles, panMs },
      browser
    );
    console.log(
      JSON.stringify(
        {
          version: 1,
          mode: 'composition',
          timestamp: new Date().toISOString(),
          url,
          startedServer: true,
          catalog,
          browser: {
            name: 'Chromium',
            version: browser.version(),
            viewport: { width: 1512, height: 982 },
            reducedMotion: 'reduce'
          },
          ...journey
        },
        null,
        2
      )
    );
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: 'string' },
      model: { type: 'string' },
      'skip-build': { type: 'boolean' },
      'keep-portable': { type: 'boolean' },
      composition: { type: 'boolean' },
      cycles: { type: 'string', default: '50' },
      'pan-ms': { type: 'string', default: '3000' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.composition) {
    await runCompositionMode(values);
    return;
  }
  const { id: model, env } = await resolveModel(values.model);
  // Everything that owns a resource is created inside the try, so the finally below is the only
  // place that releases one. An interrupt would skip that finally, so it also runs on a signal.
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  let directory: string | undefined;
  const stop = (code: number) => {
    server?.kill('SIGTERM');
    process.exit(code);
  };
  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(143));
  let url = values.url;
  try {
    if (url === undefined) {
      if (!values['skip-build']) await run('npm', ['run', 'build']);
      const port = await freePort();
      url = `http://127.0.0.1:${port}`;
      server = spawn('node', ['build'], {
        cwd: ROOT,
        env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' },
        stdio: ['ignore', 'ignore', 'inherit']
      });
      await waitForServer(url, 30000);
    } else url = url.replace(/\/$/, '');

    directory = await mkdtemp(join(tmpdir(), 'fractal-bench-'));
    const portablePath = join(directory, `${model}.html`);
    if (!(await exists(join(ROOT, 'build', 'portable.json'))))
      await run('npm', ['run', 'build:portable']);
    await run(
      'node',
      [
        '--import',
        'tsx',
        join(ROOT, 'scripts', 'fractal.ts'),
        'export',
        '--model',
        model,
        '--format',
        'html',
        '--output',
        portablePath
      ],
      env
    );

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1512, height: 982 },
      reducedMotion: 'reduce'
    });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();

    const opened = Date.now();
    await page.goto(`${url}/?model=${encodeURIComponent(model)}`, { waitUntil: 'load' });
    await settle(page);
    const pageOpenMs = Date.now() - opened;
    const requests = await apiRequests(page);
    // Long tasks counted during page open: a nonzero count is also the proof that the observer
    // is live, so "no long tasks during a toggle" is a measurement rather than a silent failure.
    const studio = {
      pageOpenMs,
      domAtOpen: await diagramDom(page),
      requests,
      longTasksDuringOpen: await longTasksSoFar(page),
      ...(await measureToggles(page, true))
    };

    const reader = await context.newPage();
    await reader.goto(`file://${portablePath}`, { waitUntil: 'load' });
    await settle(reader);
    const portableStat = await stat(portablePath);
    // The portable viewer has no Show all control: it is a reader, not the studio.
    const portable = {
      bytes: portableStat.size,
      domAtOpen: await diagramDom(reader),
      ...(values['keep-portable'] ? { path: portablePath } : {}),
      longTasksDuringOpen: await longTasksSoFar(reader),
      ...(await measureToggles(reader, false))
    };

    console.log(
      JSON.stringify(
        {
          version: 1,
          timestamp: new Date().toISOString(),
          model,
          browser: {
            name: 'Chromium',
            version: browser.version(),
            viewport: { width: 1512, height: 982 },
            reducedMotion: 'reduce'
          },
          url,
          startedServer: server !== undefined,
          headline: {
            studioExpandMs: studio.expand.latencyMs,
            studioCollapseMs: studio.collapse.latencyMs,
            studioShowAllMs: studio.showAll?.latencyMs ?? null,
            portableExpandMs: portable.expand.latencyMs,
            portableCollapseMs: portable.collapse.latencyMs
          },
          studio,
          portable
        },
        null,
        2
      )
    );
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
    if (directory !== undefined && !values['keep-portable'])
      await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
