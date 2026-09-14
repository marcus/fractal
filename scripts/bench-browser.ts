#!/usr/bin/env node
// Browser-side proof for the layout work: what a reader actually waits for. Opens the studio,
// records the page-open request waterfall, and times click-to-geometry for one expand, one
// collapse and show-all, with frame timing and long tasks during each; then does the same
// toggles in a freshly exported portable document. Toggle latency is the headline number.
// Prints JSON. This is a proof tool, not part of CI.
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { access, cp, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { percentile } from '../src/lib/bench';
import { encodeCompositionState } from '../src/lib/composition/codec';
import { stateFromComposition } from '../src/lib/composition/state';
import type { CompositionState } from '../src/lib/composition/types';
import type { Model } from '../src/lib/core/types';
import { loadDirectory, resolveCatalog, catalogResolver } from '../src/lib/server/models';
import {
  PAINT_ROOTS,
  fixtureDigest,
  generateFixtures,
  paintSources,
  writeFixtures
} from './bench-fixtures';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Fractal · browser layout benchmark

Usage: npm run bench:browser -- [options]

Measures click-to-geometry latency in a real browser: one expand, one collapse and show-all in
the studio, then the same toggles in a portable HTML document. Prints one JSON document.

Options:
  --url URL        Measure a studio already running at this URL
  --model ID       Model to open (default: the largest model in the resolved catalog; a real
                   composition's root when --catalog is set)
  --catalog PATH   Run the real-catalog composition journey against this catalog.json
  --skip-build     Reuse an existing build/ instead of running npm run build
  --keep-portable  Leave the exported portable document on disk and report its path
  --composition    Run the host/plugin linked journey against a private temp catalog: cold
                   startup with zero foreign fetches, open a link, expand, pan/zoom, cycles
  --composition ID Real catalog: restore this authored composition and measure pan/zoom, warm
                   toggles, cold reveals and open/close cycles (needs --catalog and --model)
  --cycles N       Open/close cycles in the composition journey (default 50)
  --warmup-cycles N  Cycles excluded from the retained-heap gate (default 10)
  --toggles N      Warm expand/collapse pairs for the real journey (default 20)
  --cold-opens N   Fresh-page-load reveals for the real journey (default 5)
  --scale-fixture  Generate the 300-node / 600-edge pair and measure pan/zoom on it
  --paint-ab       Generate a 20-link and a zero-link root and report the first-paint ratio
  --paint-samples N  Alternating first-paint samples per root (default 5)
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
   * Arm busy-feedback observation for the next reveal. The MutationObserver below records the
   * first loading-badge appearance after this call, so its timestamp is relative to the click
   * watch times.
   */
  armBadge() {
    window.__bench._badgeSeen = false;
    window.__bench.badgeAppearedAt = null;
    window.__bench._badgeArmed = true;
    return true;
  },
  /**
   * Resolves when at least the requested number of project frames are mounted, timed from the
   * click that caused the reveal. A reveal's real geometry is a composed frame, which arrives
   * after the server response, so this is more honest than any incidental DOM change.
   */
  watchFrames(count, timeoutMs) {
    var taskCount = window.__bench.longTasks.length;
    var opened = performance.now();
    var start = null;
    var latency = null;
    var frames = [];
    var last = opened;
    var onClick = function () {
      start = performance.now();
      window.__bench.revealStart = start;
      document.removeEventListener('click', onClick, true);
    };
    document.addEventListener('click', onClick, true);
    return new Promise(function (resolve) {
      var tick = function () {
        var now = performance.now();
        if (start !== null) frames.push(now - last);
        last = now;
        if (
          start !== null &&
          latency === null &&
          document.querySelectorAll('[data-project-frame]').length >= count
        )
          latency = now - start;
        var done = latency !== null && now - start > 200;
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
      // The reveal's busy-feedback window is measured from this same click.
      window.__bench.revealStart = start;
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
try {
  var badgeObserver = new MutationObserver(function () {
    if (!window.__bench._badgeArmed || window.__bench._badgeSeen) return;
    if (document.querySelector('.loading-badge')) {
      window.__bench._badgeSeen = true;
      window.__bench.badgeAppearedAt = performance.now();
    }
  });
  badgeObserver.observe(document, { childList: true, subtree: true });
} catch (error) {
  /* The reveal latency remains valid without badge timing. */
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

/**
 * Click a control and report what the diagram did, timed from the click event itself. A locator
 * is accepted because a composed toggle is an SVG `<g role="button">`, not a `<button>`.
 */
async function measureClick(
  page: Page,
  target: string | Locator,
  label: string
): Promise<ToggleResult> {
  const control = typeof target === 'string' ? page.locator(target).first() : target.first();
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

/** Mounted content scoped to the composed canvas, excluding the hidden single-model canvas. */
async function compositionDom(page: Page) {
  return page.evaluate(() => ({
    nodes: document.querySelectorAll('.composition-canvas [data-node-id]').length,
    edges: document.querySelectorAll('.composition-canvas [data-edge-id]').length,
    elements: document.querySelectorAll('.composition-canvas svg *').length
  }));
}

async function longTasksSoFar(page: Page): Promise<number> {
  return (await page.evaluate('window.__bench.longTasks.length')) as number;
}

/** The studio shows this badge while the server composes a view; it must be gone before timing. */
async function settle(page: Page): Promise<void> {
  // A composition hides the single-model canvas, so wait for a node that is actually visible.
  await page
    .locator('[data-node-id]:visible')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
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
  try {
    await page.waitForFunction(
      (expected: number) => document.querySelectorAll('[data-project-frame]').length === expected,
      count,
      { timeout }
    );
  } catch {
    const mounted = await page
      .locator('[data-project-frame]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-project-frame') ?? '?'))
      .catch(() => [] as string[]);
    throw new Error(`waitForFrames(${count}) timed out; mounted=[${mounted.join(', ')}]`);
  }
}

/**
 * A linked frame opens offscreen by design, so fit the whole composition before clicking anything
 * inside it, then wait until the frame actually sits within the diagram area.
 */
async function fitComposition(page: Page, model = 'plugin'): Promise<void> {
  await page.getByRole('button', { name: 'Fit composition', exact: true }).click();
  await page.waitForFunction(
    (id: string) => {
      const frame = document.querySelector(`[data-project-frame="${id}"]`);
      const area = document.querySelector('.diagram-area');
      if (!frame || !area) return false;
      const f = frame.getBoundingClientRect();
      const a = area.getBoundingClientRect();
      return (
        f.left >= a.left - 1 &&
        f.top >= a.top - 1 &&
        f.right <= a.right + 1 &&
        f.bottom <= a.bottom + 1
      );
    },
    model,
    { timeout: 10000 }
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
  await fitComposition(page);
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
  /** Cycles excluded from the retained-heap gate, measured from the warm-up boundary. */
  warmupCycles: number;
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
  // The new frame lands offscreen; fit before reaching into it.
  await fitComposition(page);

  const expand = await measureClick(
    page,
    page.getByRole('button', { name: 'Expand Beacon plugin', exact: true }),
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
  let heapWarmup: HeapReading | null = null;
  for (let i = 0; i < options.cycles; i++) {
    await closeLinked(page);
    await openLinked(page);
    // Early growth is mostly V8 JIT and Chromium's performance timeline. The plan's gate is
    // retained heap after warm-up, so take a reading at the boundary when there is room for one.
    if (
      options.warmupCycles > 0 &&
      i + 1 === options.warmupCycles &&
      options.cycles > options.warmupCycles
    )
      heapWarmup = await readHeap(page);
  }
  const cyclesWallMs = Date.now() - cyclesStarted;
  const cycleLongTasks = (await page.evaluate(
    `window.__bench.longTasks.slice(${tasksBeforeCycles})`
  )) as { startMs: number; durationMs: number }[];
  const heapAfter = await readHeap(page);

  const longTasksOver50 = [...open.longTasks, ...expand.longTasks, ...panZoom.longTasks].filter(
    (task) => task.durationMs > 50
  );
  const growthPercent = (from: number, to: number): number | null =>
    from > 0 ? round(((to - from) / from) * 100) : null;
  const heap =
    heapBefore && heapAfter
      ? {
          supported: true,
          beforeBytes: heapBefore.used,
          // Bytes after the excluded warm-up cycles; null when the run is too short to exclude any.
          warmupBytes: heapWarmup?.used ?? null,
          afterBytes: heapAfter.used,
          growthBytes: heapAfter.used - heapBefore.used,
          growthPercent: growthPercent(heapBefore.used, heapAfter.used),
          warmupCycles: options.warmupCycles,
          warmupExcludedGrowthBytes: heapWarmup === null ? null : heapAfter.used - heapWarmup.used,
          warmupExcludedGrowthPercent:
            heapWarmup === null ? null : growthPercent(heapWarmup.used, heapAfter.used),
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
      retainedHeapGrowthPercent: heap.supported ? heap.growthPercent : null,
      retainedHeapGrowthWarmupExcludedPercent: heap.supported
        ? heap.warmupExcludedGrowthPercent
        : null
    },
    longTasksOver50
  };
}

/** p50/p95 over the non-null samples that were actually collected. */
function percentiles(values: readonly (number | null)[]): {
  p50: number | null;
  p95: number | null;
  samples: number;
} {
  const clean = values.filter((value): value is number => value !== null);
  if (!clean.length) return { p50: null, p95: null, samples: 0 };
  return {
    p50: round(percentile(clean, 0.5)),
    p95: round(percentile(clean, 0.95)),
    samples: clean.length
  };
}

interface RevealResult extends ToggleResult {
  /** Milliseconds from the click until `.loading-badge` first appeared, or null if never. */
  badgeMs: number | null;
}

/** A click-to-geometry reveal that also records the busy indicator relative to the click. */
async function measureReveal(
  page: Page,
  target: string | Locator,
  label: string
): Promise<RevealResult> {
  const control = typeof target === 'string' ? page.locator(target).first() : target.first();
  await control.waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate('window.__bench.armBadge()');
  const watching = page.evaluate('window.__bench.watchFrames(2, 30000)') as Promise<RawWatch>;
  await control.click();
  const result = summarize(label, await watching);
  // Let any busy badge appear and clear before reading its first-appearance timestamp.
  await page
    .waitForFunction("document.querySelectorAll('.loading-badge').length === 0", undefined, {
      timeout: 30000
    })
    .catch(() => undefined);
  const badge = (await page.evaluate(
    `(function () {
      var appeared = window.__bench.badgeAppearedAt;
      var start = window.__bench.revealStart;
      return appeared !== null && start !== null ? appeared - start : null;
    })()`
  )) as number | null;
  return { ...result, badgeMs: badge === null ? null : round(badge) };
}

/** Sustained pan/zoom over the composition camera; frame deltas and long tasks over the window. */
async function panZoomSample(page: Page, panMs: number): Promise<ToggleResult> {
  await page.locator('.composition-canvas svg').focus();
  const sampling = page.evaluate(`window.__bench.sample(${panMs})`) as Promise<RawWatch>;
  const canvas = (await page.locator('.composition-canvas svg').boundingBox())!;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i % 2 === 0 ? '=' : '-');
    await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.5);
    await page.mouse.wheel(0, i % 2 === 0 ? -160 : 160);
    await page.waitForTimeout(Math.max(20, Math.floor(panMs / 12)));
  }
  return summarize('pan/zoom', await sampling);
}

interface StatsPayload {
  caches: {
    models: { misses: number; entries: number; bytes: number };
    layouts: { misses: number; entries: number; bytes: number };
    composed: { misses: number; entries: number; bytes: number };
  };
}

async function compositionStats(url: string): Promise<StatsPayload> {
  return (await (await fetch(`${url}/api/composition/stats`)).json()) as StatsPayload;
}

function compositionUrl(url: string, model: string, encoded: string): string {
  return `${url}/?model=${encodeURIComponent(model)}&composition=${encodeURIComponent(encoded)}`;
}

interface ElementMeta {
  title: string;
  parent: string | null;
}
type RootElements = Record<string, ElementMeta>;
interface RootLink {
  id: string;
  from?: string;
  target: { model: string };
}

function sourceChain(elements: RootElements, from: string): string[] {
  const chain: string[] = [];
  let id: string | null = from;
  while (id !== null && elements[id] !== undefined) {
    chain.unshift(id);
    id = elements[id].parent;
  }
  return chain;
}

/**
 * Select the authored element a link starts from. The top-level ancestor is clicked on the canvas;
 * every deeper level is a child link in the inspector, so a nested source (e.g. a component inside
 * a collapsed subsystem) is reachable without expanding the canvas first.
 */
async function selectElement(
  page: Page,
  elements: RootElements,
  elementId: string,
  frame?: string
): Promise<void> {
  const chain = sourceChain(elements, elementId);
  if (!chain.length) throw new Error(`Unknown element: ${elementId}`);
  const node = frame
    ? page.locator(`.composition-canvas [data-node-id="${frame}:${chain[0]}"]`)
    : page.locator(`[data-node-id="${chain[0]}"]`);
  await node.first().click();
  for (let i = 1; i < chain.length; i++) {
    const title = elements[chain[i]].title;
    await page
      .locator('section[aria-label="Inside this component"]')
      .getByRole('button', { name: title, exact: true })
      .first()
      .click();
  }
}

/** The first expandable control inside a project frame, or null when the project is fully open. */
async function firstExpandTitle(page: Page, frame: string): Promise<string | null> {
  const labels = await page
    .locator(`[data-project="${frame}"] [aria-label^="Expand "]`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  const label = labels.find((candidate) => candidate.startsWith('Expand '));
  return label === undefined ? null : label.slice('Expand '.length);
}

async function closeProject(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: `Project options: ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close' }).click();
}

/** Reopen a closed project from its authored link, reselecting the source when it is not present. */
async function reopenLink(
  page: Page,
  link: RootLink,
  elements: RootElements,
  frame: string,
  expectedFrames: number
): Promise<void> {
  const selector = `[data-open-link="${link.id}"]`;
  if ((await page.locator(selector).count()) === 0) {
    if (link.from === undefined) throw new Error(`Link ${link.id} has no source element`);
    await selectElement(page, elements, link.from, frame);
  }
  await page.locator(selector).first().click();
  await waitForFrames(page, expectedFrames);
}

interface ToggleLoopResult {
  target: string;
  latency: { p50: number | null; p95: number | null; samples: number };
  samplesMs: (number | null)[];
  layoutMissesDelta: number;
  composedMissesDelta: number;
}

/**
 * Warm-up expand/collapse, then `pairs` measured pairs. Input-to-geometry is the click-to-signature
 * change; layout misses are read from the server around the measured loop so an unrelated project
 * relayout would show up as growth.
 */
async function toggleLoop(
  page: Page,
  url: string,
  frame: string,
  title: string,
  pairs: number
): Promise<ToggleLoopResult> {
  const frameLoc = page.locator(`[data-project="${frame}"]`);
  const expand = frameLoc.getByRole('button', { name: `Expand ${title}`, exact: true });
  const collapse = frameLoc.getByRole('button', { name: `Collapse ${title}`, exact: true });
  await measureClick(page, expand, `warm-up expand ${title}`);
  await settle(page);
  await measureClick(page, collapse, `warm-up collapse ${title}`);
  await settle(page);
  const before = await compositionStats(url);
  const samplesMs: (number | null)[] = [];
  for (let i = 0; i < pairs; i++) {
    samplesMs.push((await measureClick(page, expand, `expand ${title}`)).latencyMs);
    await settle(page);
    samplesMs.push((await measureClick(page, collapse, `collapse ${title}`)).latencyMs);
    await settle(page);
  }
  const after = await compositionStats(url);
  return {
    target: title,
    latency: percentiles(samplesMs),
    samplesMs,
    layoutMissesDelta: after.caches.layouts.misses - before.caches.layouts.misses,
    composedMissesDelta: after.caches.composed.misses - before.caches.composed.misses
  };
}

interface BuiltComposition {
  encoded: string;
  projects: number;
  rootElements: RootElements;
  target: { model: string; title: string; link: RootLink };
}

/** Resolve a real composition from a catalog into a URL-replayable state plus navigation metadata. */
async function buildComposition(
  catalog: string,
  root: string,
  compositionId: string
): Promise<BuiltComposition> {
  const resolver = catalogResolver({ catalog });
  const rootOutcome = await resolver.resolve(root);
  if (rootOutcome.status !== 'resolved')
    throw new Error(`Root ${root} could not be resolved: ${rootOutcome.message}`);
  const rootSnapshot = rootOutcome.snapshot;
  const composition = rootSnapshot.links?.compositions.find(
    (candidate) => candidate.id === compositionId
  );
  if (!composition) throw new Error(`Unknown composition: ${compositionId} in ${root}`);
  const snapshots = new Map([[root, rootSnapshot]]);
  for (const entry of composition.projects) {
    const outcome = await resolver.resolve(entry.model);
    if (outcome.status === 'resolved') snapshots.set(entry.model, outcome.snapshot);
  }
  const state = stateFromComposition(rootSnapshot, compositionId, (model) => snapshots.get(model));
  const encoded = encodeCompositionState(state);
  const rootElements: RootElements = Object.fromEntries(
    rootSnapshot.model.elements.map((element) => [
      element.id,
      { title: element.title, parent: element.parent }
    ])
  );
  const targetModel = composition.projects[0]?.model ?? root;
  const link = rootSnapshot.links?.links.find((entry) => entry.target.model === targetModel);
  if (!link) throw new Error(`No link from ${root} to ${targetModel}`);
  return {
    encoded,
    projects: state.projects.length,
    rootElements,
    target: {
      model: targetModel,
      title: snapshots.get(targetModel)?.model.title ?? targetModel,
      link: { id: link.id, from: link.from, target: { model: link.target.model } }
    }
  };
}

interface HeapGrowth {
  supported: boolean;
  cycles: number;
  beforeBytes: number | null;
  warmupBytes: number | null;
  afterBytes: number | null;
  growthBytes: number | null;
  growthPercent: number | null;
  warmupCycles: number;
  warmupExcludedGrowthBytes: number | null;
  warmupExcludedGrowthPercent: number | null;
}

function heapGrowth(
  before: HeapReading | null,
  warmup: HeapReading | null,
  after: HeapReading | null,
  warmupCycles: number,
  cycles: number
): HeapGrowth {
  if (!before || !after)
    return {
      supported: false,
      cycles,
      beforeBytes: null,
      warmupBytes: null,
      afterBytes: null,
      growthBytes: null,
      growthPercent: null,
      warmupCycles,
      warmupExcludedGrowthBytes: null,
      warmupExcludedGrowthPercent: null
    };
  const percent = (from: number, to: number): number | null =>
    from > 0 ? round(((to - from) / from) * 100) : null;
  return {
    supported: true,
    cycles,
    beforeBytes: before.used,
    warmupBytes: warmup?.used ?? null,
    afterBytes: after.used,
    growthBytes: after.used - before.used,
    growthPercent: percent(before.used, after.used),
    warmupCycles,
    warmupExcludedGrowthBytes: warmup === null ? null : after.used - warmup.used,
    warmupExcludedGrowthPercent: warmup === null ? null : percent(warmup.used, after.used)
  };
}

const COMPOSITION_SCENE = 'overview';

/** A fresh page load of the root that clicks the link open, timed and badge-observed. */
async function coldReveal(
  url: string,
  model: string,
  built: BuiltComposition,
  browser: Browser
): Promise<Record<string, unknown>> {
  const context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    reducedMotion: 'reduce'
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  try {
    await page.goto(`${url}/?model=${encodeURIComponent(model)}`, { waitUntil: 'load' });
    await settle(page);
    if (built.target.link.from === undefined)
      throw new Error(`Link ${built.target.link.id} has no source element`);
    await selectElement(page, built.rootElements, built.target.link.from);
    const reveal = await measureReveal(
      page,
      `[data-open-link="${built.target.link.id}"]`,
      `reveal ${built.target.model}`
    );
    // A fresh root plus the one explicit open: two frames, whatever the authored composition opens.
    await waitForFrames(page, 2);
    return {
      latencyMs: reveal.latencyMs,
      badgeMs: reveal.badgeMs,
      frames: reveal.frames,
      longTasks: reveal.longTasks,
      longTaskTotalMs: reveal.longTaskTotalMs,
      dom: await compositionDom(page)
    };
  } finally {
    await context.close();
  }
}

/**
 * One reveal with a deliberately slow composition response, so the 150 ms busy timer actually
 * fires and the loading badge can be timed. This measures the feedback path, not cold latency.
 */
async function busyFeedbackProbe(
  url: string,
  model: string,
  built: BuiltComposition,
  browser: Browser
): Promise<Record<string, unknown>> {
  const context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    reducedMotion: 'reduce'
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  try {
    await page.route(/\/api\/composition\/render(\?|$)/, async (route) => {
      await new Promise((done) => setTimeout(done, 400));
      await route.continue();
    });
    await page.goto(`${url}/?model=${encodeURIComponent(model)}`, { waitUntil: 'load' });
    await settle(page);
    if (built.target.link.from === undefined)
      throw new Error(`Link ${built.target.link.id} has no source element`);
    await selectElement(page, built.rootElements, built.target.link.from);
    const reveal = await measureReveal(
      page,
      `[data-open-link="${built.target.link.id}"]`,
      `busy probe ${built.target.model}`
    );
    await waitForFrames(page, 2);
    return { latencyMs: reveal.latencyMs, badgeMs: reveal.badgeMs, longTasks: reveal.longTasks };
  } finally {
    await context.close();
  }
}

interface RealJourneyOptions {
  model: string;
  encoded: string;
  projects: number;
  rootElements: RootElements;
  target: BuiltComposition['target'];
  cycles: number;
  warmupCycles: number;
  toggles: number;
  panMs: number;
}

/** The real three-project journey: restore, pan/zoom, warm toggles, close/open cycles and heap. */
async function realCompositionJourney(
  url: string,
  options: RealJourneyOptions,
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
  // API traffic from request events, so the startup waterfall survives the resource-timing buffer.
  const apiLog: { name: string; atMs: number }[] = [];
  try {
    const opened = Date.now();
    page.on('request', (request) => {
      const target = new URL(request.url());
      if (target.pathname.startsWith('/api/'))
        apiLog.push({ name: target.pathname + target.search, atMs: Date.now() - opened });
    });
    await page.goto(compositionUrl(url, options.model, options.encoded), { waitUntil: 'load' });
    await settle(page);
    await waitForFrames(page, options.projects);
    const coldStartupMs = Date.now() - opened;
    const startupRequests = apiLog.slice();

    // Bring every frame into view before reaching into one: culling keeps offscreen contents out.
    await fitComposition(page, options.target.model);
    const toggleTitle = await firstExpandTitle(page, options.target.model);
    const toggles =
      toggleTitle === null
        ? null
        : await toggleLoop(page, url, options.target.model, toggleTitle, options.toggles);

    const panZoom = await panZoomSample(page, options.panMs);

    // Fit again so the root frame's link source is mounted, then open its inspector.
    await fitComposition(page, options.model);
    if (options.target.link.from === undefined)
      throw new Error(`Link ${options.target.link.id} has no source element`);
    await selectElement(page, options.rootElements, options.target.link.from, options.model);
    await page
      .locator(`[data-open-link="${options.target.link.id}"]`)
      .first()
      .waitFor({ state: 'attached', timeout: 15000 });

    const heapBefore = await readHeap(page);
    const tasksBefore = (await page.evaluate('window.__bench.longTasks.length')) as number;
    const cyclesStarted = Date.now();
    let heapWarmup: HeapReading | null = null;
    for (let i = 0; i < options.cycles; i++) {
      // A reopen re-anchors the camera on the revealed title, so refit to reach the next close.
      await fitComposition(page, options.target.model);
      await closeProject(page, options.target.title);
      await waitForFrames(page, options.projects - 1);
      await reopenLink(
        page,
        options.target.link,
        options.rootElements,
        options.model,
        options.projects
      );
      if (
        options.warmupCycles > 0 &&
        i + 1 === options.warmupCycles &&
        options.cycles > options.warmupCycles
      )
        heapWarmup = await readHeap(page);
    }
    const cyclesWallMs = Date.now() - cyclesStarted;
    const cycleLongTasks = (await page.evaluate(
      `window.__bench.longTasks.slice(${tasksBefore})`
    )) as { startMs: number; durationMs: number }[];
    const heapAfter = await readHeap(page);
    const heap = heapGrowth(
      heapBefore,
      heapWarmup,
      heapAfter,
      options.warmupCycles,
      options.cycles
    );
    const stats = await compositionStats(url);
    const cycleLongTasksOver50 = cycleLongTasks.filter((task) => task.durationMs > 50);

    return {
      coldStartupMs,
      startupRequests,
      panZoom,
      toggles,
      cycles: {
        count: options.cycles,
        wallMs: cyclesWallMs,
        longTasks: cycleLongTasks,
        longTasksOver50: cycleLongTasksOver50.length,
        heap
      },
      stats,
      errors,
      dom: await compositionDom(page)
    };
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; page errors: ${errors.join(' | ') || 'none'}`
    );
  } finally {
    await context.close();
  }
}

function countArg(value: string | undefined, flag: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min)
    throw new Error(`${flag} must be a whole number of at least ${min}`);
  return parsed;
}

async function startCatalogServer(catalog: string): Promise<{ url: string; server: ChildProcess }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['build'], {
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
  return { url, server };
}

/** Real catalog composition journey (items 1-3): reveals, pan/zoom, warm toggles, cycles, heap. */
async function runRealMode(values: {
  catalog: string;
  model: string;
  composition: string;
  cycles: string;
  'warmup-cycles': string;
  toggles: string;
  'cold-opens': string;
  'pan-ms': string;
  'skip-build'?: boolean;
}): Promise<void> {
  const catalog = resolve(values.catalog);
  const cycles = countArg(values.cycles, '--cycles', 1);
  const warmupCycles = countArg(values['warmup-cycles'], '--warmup-cycles', 0);
  const toggles = countArg(values.toggles, '--toggles', 0);
  const coldOpens = countArg(values['cold-opens'], '--cold-opens', 1);
  const panMs = countArg(values['pan-ms'], '--pan-ms', 100);
  const built = await buildComposition(catalog, values.model, values.composition);
  if (!values['skip-build']) await run('npm', ['run', 'build']);
  const { url, server } = await startCatalogServer(catalog);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      args: ['--js-flags=--expose-gc', '--enable-precise-memory-info']
    });
    const reveals: Record<string, unknown>[] = [];
    for (let i = 0; i < coldOpens; i++)
      reveals.push(await coldReveal(url, values.model, built, browser));
    const busyFeedback = await busyFeedbackProbe(url, values.model, built, browser);
    const main = await realCompositionJourney(
      url,
      {
        model: values.model,
        encoded: built.encoded,
        projects: built.projects,
        rootElements: built.rootElements,
        target: built.target,
        cycles,
        warmupCycles,
        toggles,
        panMs
      },
      browser
    );
    const revealLatency = percentiles(reveals.map((reveal) => reveal.latencyMs as number | null));
    const badgeSamples = reveals
      .map((reveal) => reveal.badgeMs as number | null)
      .filter((value): value is number => value !== null);
    console.log(
      JSON.stringify(
        {
          version: 1,
          mode: 'composition-real',
          timestamp: new Date().toISOString(),
          model: values.model,
          composition: values.composition,
          catalog: '<private temporary catalog>',
          browser: {
            name: 'Chromium',
            version: browser.version(),
            viewport: { width: 1512, height: 982 },
            reducedMotion: 'reduce'
          },
          reveals: {
            count: coldOpens,
            latency: revealLatency,
            badge: percentiles(badgeSamples),
            samples: reveals
          },
          busyFeedback,
          main
        },
        null,
        2
      )
    );
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}

/** Generated 300-node / 600-edge pan/zoom journey (item 4). */
async function runScaleMode(values: { 'pan-ms': string; 'skip-build'?: boolean }): Promise<void> {
  const panMs = countArg(values['pan-ms'], '--pan-ms', 100);
  if (!values['skip-build']) await run('npm', ['run', 'build']);
  const generated = generateFixtures(['scale']);
  const digest = fixtureDigest(generated);
  const fixture = generated.fixtures[0];
  const directory = await mkdtemp(join(tmpdir(), 'fractal-bench-scale-'));
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const written = await writeFixtures(generated, directory);
    const built = await buildComposition(written.catalog, fixture.root, fixture.composition);
    const started = await startCatalogServer(written.catalog);
    server = started.server;
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1512, height: 982 },
      reducedMotion: 'reduce'
    });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(compositionUrl(started.url, fixture.root, built.encoded), {
      waitUntil: 'load'
    });
    await settle(page);
    await waitForFrames(page, built.projects);
    const panZoom = await panZoomSample(page, panMs);
    const dom = await compositionDom(page);
    const longTasksOver50 = panZoom.longTasks.filter((task) => task.durationMs > 50);
    await context.close();
    console.log(
      JSON.stringify(
        {
          version: 1,
          mode: 'scale',
          timestamp: new Date().toISOString(),
          digest,
          fixture: fixture.id,
          root: fixture.root,
          composition: fixture.composition,
          panMs,
          browser: {
            name: 'Chromium',
            version: browser.version(),
            viewport: { width: 1512, height: 982 },
            reducedMotion: 'reduce'
          },
          panZoom,
          dom,
          longTasksOver50,
          errors
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

/** First-paint A/B for a 20-unopened-link root against a zero-link root (item 5). */
async function runPaintMode(values: {
  'paint-samples': string;
  'skip-build'?: boolean;
}): Promise<void> {
  const samples = countArg(values['paint-samples'], '--paint-samples', 1);
  if (!values['skip-build']) await run('npm', ['run', 'build']);
  const sources = paintSources();
  const digest = fixtureDigest(sources);
  const directory = await mkdtemp(join(tmpdir(), 'fractal-bench-paint-'));
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const written = await writeFixtures(sources, directory);
    const started = await startCatalogServer(written.catalog);
    server = started.server;
    browser = await chromium.launch();
    const observations: Record<string, number>[] = [];
    for (let i = 0; i < samples; i++) {
      const order =
        i % 2 === 0
          ? [PAINT_ROOTS.links, PAINT_ROOTS.plain]
          : [PAINT_ROOTS.plain, PAINT_ROOTS.links];
      const record: Record<string, number> = {};
      for (const id of order) {
        const context = await browser.newContext({
          viewport: { width: 1512, height: 982 },
          reducedMotion: 'reduce'
        });
        await context.addInitScript(INIT_SCRIPT);
        const page = await context.newPage();
        const opened = Date.now();
        await page.goto(`${started.url}/?model=${encodeURIComponent(id)}`, { waitUntil: 'load' });
        await settle(page);
        record[id] = Date.now() - opened;
        await context.close();
      }
      observations.push(record);
    }
    const links = observations.map((record) => record[PAINT_ROOTS.links]);
    const plain = observations.map((record) => record[PAINT_ROOTS.plain]);
    const linksMedian = round(percentile(links, 0.5));
    const plainMedian = round(percentile(plain, 0.5));
    const ratio = plainMedian > 0 ? round(linksMedian / plainMedian) : null;
    console.log(
      JSON.stringify(
        {
          version: 1,
          mode: 'paint',
          timestamp: new Date().toISOString(),
          digest,
          samples,
          roots: PAINT_ROOTS,
          linksMs: links,
          plainMs: plain,
          medians: { links: linksMedian, plain: plainMedian },
          ratio
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

/**
 * Start a private server over an isolated temp catalog holding only the fictional host and plugin
 * fixtures, then run the composition journey. Repository models are never copied or bundled.
 */
async function runCompositionMode(values: {
  model?: string;
  'skip-build'?: boolean;
  cycles: string;
  'warmup-cycles': string;
  'pan-ms': string;
}): Promise<void> {
  const cycles = Number(values.cycles);
  if (!Number.isInteger(cycles) || cycles < 1)
    throw new Error('--cycles must be a whole number of at least 1');
  const warmupCycles = Number(values['warmup-cycles']);
  if (!Number.isInteger(warmupCycles) || warmupCycles < 0)
    throw new Error('--warmup-cycles must be a whole number of at least 0');
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
      { model: values.model ?? 'host', scene: COMPOSITION_SCENE, cycles, warmupCycles, panMs },
      browser
    );
    // Server-side cache bounds after the cycles, so the retained-heap gate and the byte/count
    // bounds are read from the same run.
    const stats = await (await fetch(`${url}/api/composition/stats`)).json();
    console.log(
      JSON.stringify(
        {
          version: 1,
          mode: 'composition',
          timestamp: new Date().toISOString(),
          model: values.model ?? 'host',
          scene: COMPOSITION_SCENE,
          url,
          startedServer: true,
          catalog,
          stats,
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

/**
 * `--composition` is both a mode switch and, with a value, a real authored composition selector.
 * Node's argument parser cannot express an optional value, so pull it out before parsing.
 */
function extractComposition(argv: string[]): { args: string[]; real?: string; matrix: boolean } {
  const args: string[] = [];
  let matrix = false;
  let real: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--composition') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        real = next;
        i++;
      } else matrix = true;
    } else if (token.startsWith('--composition=')) {
      real = token.slice('--composition='.length);
    } else args.push(token);
  }
  return { args, ...(real === undefined ? {} : { real }), matrix };
}

async function main(): Promise<void> {
  const extracted = extractComposition(process.argv.slice(2));
  const { values } = parseArgs({
    args: extracted.args,
    options: {
      url: { type: 'string' },
      model: { type: 'string' },
      catalog: { type: 'string' },
      'skip-build': { type: 'boolean' },
      'keep-portable': { type: 'boolean' },
      'scale-fixture': { type: 'boolean' },
      'paint-ab': { type: 'boolean' },
      cycles: { type: 'string', default: '50' },
      'warmup-cycles': { type: 'string', default: '10' },
      toggles: { type: 'string', default: '20' },
      'cold-opens': { type: 'string', default: '5' },
      'paint-samples': { type: 'string', default: '5' },
      'pan-ms': { type: 'string', default: '3000' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values['scale-fixture']) {
    await runScaleMode(values);
    return;
  }
  if (values['paint-ab']) {
    await runPaintMode(values);
    return;
  }
  if (extracted.real !== undefined) {
    if (values.catalog === undefined)
      throw new Error('--composition ID needs --catalog PATH for the real-catalog journey');
    await runRealMode({
      catalog: values.catalog,
      model: values.model ?? 'sidecar',
      composition: extracted.real,
      cycles: values.cycles,
      'warmup-cycles': values['warmup-cycles'],
      toggles: values.toggles,
      'cold-opens': values['cold-opens'],
      'pan-ms': values['pan-ms'],
      ...(values['skip-build'] ? { 'skip-build': true } : {})
    });
    return;
  }
  if (extracted.matrix) {
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
