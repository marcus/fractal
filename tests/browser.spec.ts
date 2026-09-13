import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function ready(page: Page) {
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  // The badge only appears for slow requests; the busy state is the render-complete signal.
  await expect(page.locator('.diagram-area')).toHaveAttribute('aria-busy', 'false');
}
async function scene(page: Page, name: string) {
  await page.getByRole('button', { name }).click();
  await ready(page);
}
/**
 * The floating shell put the studio's chrome on the canvas rather than around it. These
 * helpers name the controls the old grid layout exposed differently, so the tests below keep
 * describing behaviour instead of markup.
 */
/** The theme is a fly-out on the bar now, not a select. */
async function chooseTheme(page: Page, name: 'Grove' | 'Graphite' | 'Midnight') {
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
}
/** Navigation has two hide controls — the canvas corner and the panel grip. This is the corner. */
const navToggle = (page: Page) => page.locator('button.nav-toggle-corner');
/** The perspective title sits in the bar; the canvas heading only returns for presentations. */
const sceneTitle = (page: Page) => page.locator('.crumb-scene');
/** A point on the open canvas, clear of the floating navigation, inspector and bar. */
const openCanvas = { x: 760, y: 620 };

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`component expansion follows its title at the current scale (${reducedMotion})`, async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    await ready(page);
    await page.waitForTimeout(750);
    const node = page.locator('[data-node-id="core"]');
    const position = () =>
      node
        .locator('.node-title')
        .first()
        .evaluate((element) => {
          const text = element as SVGTextElement;
          const matrix = text.getScreenCTM()!;
          const point = new DOMPoint(
            text.x.baseVal[0].value,
            text.y.baseVal[0].value
          ).matrixTransform(matrix);
          return { x: point.x, y: point.y, scale: matrix.a };
        });
    const before = await position();
    const oldTransform = await node.getAttribute('transform');
    // Sample the whole transition: an after-only assertion misses a camera that catches up late.
    const samples = node
      .locator('.node-title')
      .first()
      .evaluate(async (element) => {
        const text = element as SVGTextElement;
        const points: { x: number; y: number; scale: number }[] = [];
        const started = performance.now();
        while (performance.now() - started < 1100) {
          await new Promise(requestAnimationFrame);
          const matrix = text.getScreenCTM()!;
          const point = new DOMPoint(
            text.x.baseVal[0].value,
            text.y.baseVal[0].value
          ).matrixTransform(matrix);
          points.push({ x: point.x, y: point.y, scale: matrix.a });
        }
        return points;
      });
    await page.getByRole('button', { name: 'Expand Delivery Operations', exact: true }).click();
    await ready(page);
    for (const point of await samples) {
      expect(Math.abs(point.x - before.x)).toBeLessThan(1);
      expect(Math.abs(point.y - before.y)).toBeLessThan(1);
      expect(point.scale).toBeCloseTo(before.scale, 5);
    }
    expect(await node.getAttribute('transform')).not.toBe(oldTransform);
    await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
    await page.screenshot({ path: `artifacts/expansion-follow-${reducedMotion}.png` });

    await node.focus();
    await page.keyboard.press('Space');
    await ready(page);
    await expect(page.locator('[data-node-id="core.shipments"]')).toHaveCount(0);
    const collapsed = await position();
    expect(collapsed.x).toBeCloseTo(before.x, 1);
    expect(collapsed.y).toBeCloseTo(before.y, 1);
    expect(collapsed.scale).toBeCloseTo(before.scale, 5);

    await page
      .getByRole('button', { name: 'Expand Delivery Operations in outline', exact: true })
      .click();
    await ready(page);
    await page.waitForTimeout(750);
    const outlined = await position();
    expect(outlined.x).toBeCloseTo(before.x, 1);
    expect(outlined.y).toBeCloseTo(before.y, 1);
    expect(outlined.scale).toBeCloseTo(before.scale, 5);
  });
}

test('zoom out never zooms in after following a collapsed component', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Expand Delivery Operations', exact: true }).click();
  await ready(page);
  // Zoom is a key or a gesture, not a button: the corner keeps only the fit control.
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(0);
  await page.getByRole('application').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('-');
  await page
    .getByRole('button', { name: 'Collapse Delivery Operations in outline', exact: true })
    .click();
  await ready(page);
  const title = page.locator('[data-node-id="core"] .node-title').first();
  const scale = () =>
    title.evaluate((element) => (element as SVGGraphicsElement).getScreenCTM()!.a);
  const before = await scale();
  await page.getByRole('application').focus();
  await page.keyboard.press('-');
  expect(await scale()).toBeLessThanOrEqual(before);
  // The canvas is full bleed, so wheel over open canvas rather than under the floating panel.
  await page.getByRole('application').hover({ position: openCanvas });
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(100);
  expect(await scale()).toBeLessThanOrEqual(before);
  await page.getByRole('application').focus();
  await page.keyboard.press('=');
  expect(await scale()).toBeGreaterThan(before);
});

test('the inspector does not reframe a double-click expansion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(750);
  const node = page.locator('[data-node-id="core"]');
  await node.locator('.node-title').first().dblclick();
  await expect(node).toHaveAttribute('aria-label', 'Delivery Operations, expanded');
  // Let the inspector's width transition settle before comparing drawing scales.
  await page.waitForTimeout(350);
  const scale = () =>
    node
      .locator('.node-title')
      .first()
      .evaluate((element) => (element as SVGGraphicsElement).getScreenCTM()!.a);
  const duringExpansion = await scale();
  await expect(page.locator('.inspector')).toBeVisible();
  await page.waitForTimeout(1100);
  expect(await scale()).toBeCloseTo(duringExpansion, 5);
});

test('manual zoom and pan take over without drifting during expansion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(750);
  const node = page.locator('[data-node-id="core"]');
  const transform = () =>
    node.evaluate((element) => {
      const matrix = (element.parentElement as unknown as SVGGraphicsElement).getScreenCTM()!;
      return { scale: matrix.a, x: matrix.e, y: matrix.f };
    });
  const before = await transform();
  await page.getByRole('button', { name: 'Expand Delivery Operations', exact: true }).click();
  await expect(node).toHaveAttribute('aria-label', 'Delivery Operations, expanded');
  await page.getByRole('application').focus();
  await page.keyboard.press('=');
  const zoomed = await transform();
  expect(zoomed.scale).toBeCloseTo(before.scale * 1.2, 5);
  const box = (await page.getByRole('application').boundingBox())!;
  await page.mouse.move(box.x + openCanvas.x, box.y + openCanvas.y);
  await page.mouse.down();
  await page.mouse.move(box.x + openCanvas.x + 50, box.y + openCanvas.y + 30, { steps: 3 });
  await page.mouse.up();
  const panned = await transform();
  expect(panned.x - zoomed.x).toBeCloseTo(50, 1);
  expect(panned.y - zoomed.y).toBeCloseTo(30, 1);
  await page.waitForTimeout(750);
  const settled = await transform();
  expect(settled.scale).toBeCloseTo(panned.scale, 5);
  expect(settled.x).toBeCloseTo(panned.x, 1);
  expect(settled.y).toBeCloseTo(panned.y, 1);
});

test('mixed detail, focus, external context, pan selection, and URL restoration', async ({
  page
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await ready(page);
  await expect(page.locator('[data-node-id]')).toHaveCount(5);
  await page.getByRole('button', { name: 'Expand Delivery Operations', exact: true }).click();
  await ready(page);
  await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
  await expect(page.locator('[data-node-id="intake"]')).toBeVisible();
  await page.locator('[data-node-id="core"]').click({ position: { x: 40, y: 20 } });
  await page.getByRole('button', { name: 'Focus this component' }).click();
  await ready(page);
  await expect(page.locator('[data-node-id="intake"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Diagram key', exact: true }).click();
  await page.getByRole('button', { name: /external connections/ }).click();
  await expect(page.getByRole('heading', { name: 'Connected beyond this view' })).toBeVisible();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  const canvas = page.getByRole('application', {
    name: 'Fictional Delivery Service interactive architecture'
  });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 75);
  await page.mouse.up();
  await page.locator('[data-node-id="core.shipments"]').click();
  await expect(page.locator('.inspector h2')).toHaveText('Shipment lifecycle');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  const url = page.url();
  await page.reload();
  await ready(page);
  await expect(page).toHaveURL(url);
  await expect(page.locator('[data-node-id="intake"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('scenes, proposal status, trust membership, and text containment', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await scene(page, '03 Where responsibility changes');
  const loaded = await (await page.request.get('/api/models/delivery')).json();
  const members = loaded.model.boundaries.flatMap((b: { id: string; members: string[] }) =>
    b.members.map((id) => ({ id, boundary: b.id }))
  );
  for (const { id, boundary } of members)
    if (await page.locator(`[data-node-id="${id}"]`).count())
      await expect(
        page.locator(`[data-node-id="${id}"] [data-boundary-id="${boundary}"]`)
      ).toHaveCount(1);
  const clipping = await page.locator('[data-node-id]').evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const rect = node.querySelector('rect');
      if (!rect) return [];
      const w = Number(rect.getAttribute('width'));
      return Array.from(node.querySelectorAll(':scope > text'))
        .filter((t) => t.getAttribute('opacity') !== '0')
        .flatMap((t) => {
          const b = (t as SVGGraphicsElement).getBBox();
          return b.x < 0 || b.x + b.width > w - 6
            ? [`${node.getAttribute('data-node-id')}: ${t.textContent}`]
            : [];
        });
    })
  );
  expect(clipping).toEqual([]);
  await page.screenshot({ path: 'artifacts/trust-browser.png' });
  await scene(page, '04 The next chapter');
  await expect(page.getByRole('checkbox', { name: 'Proposed' })).toBeChecked();
  await expect(page.locator('[data-node-id="outputs.courier"]')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Proposed' }).uncheck();
  await ready(page);
  await expect(page.locator('[data-node-id="outputs.courier"]')).toHaveCount(0);
});

test('native source dialog keyboard and real SVG / PNG exports', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await scene(page, '02 Inside delivery operations');
  await page.getByRole('button', { name: 'Model source' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox', { name: 'LikeC4 model source' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const format of ['Vector SVG', 'High-resolution PNG']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.locator('.export-preview img')).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(format) }).click();
    const file = await pending;
    const data = await readFile((await file.path())!);
    if (format === 'Vector SVG') {
      expect(data.toString()).toContain('width="1920"');
      expect(data.toString()).toContain('external connections outside view');
      expect(data.toString()).not.toContain('foreignObject');
      await file.saveAs('artifacts/delivery-execution.svg');
    } else {
      expect(data.readUInt32BE(16)).toBe(3840);
      expect(data.readUInt32BE(20)).toBe(2160);
      await file.saveAs('artifacts/delivery-execution.png');
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('presentation navigation, second model, narrow layout', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  // Presentation drops the whole floating shell: no bar, no panels, no corner furniture.
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.appbar')).toHaveCount(0);
  await expect(page.locator('.nav-toggle-corner, .wordmark-corner')).toHaveCount(0);
  // The canvas heading, hidden behind the bar everywhere else, is the title here.
  await expect(page.locator('.studio')).toHaveClass(/presenting/);
  await page.keyboard.press('ArrowRight');
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inside delivery operations');
  await page.screenshot({ path: 'artifacts/presentation-browser.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(navToggle(page)).toBeVisible();
  await page.getByRole('button', { name: /Switch project:/ }).click();
  await page.getByRole('combobox', { name: 'Search projects', exact: true }).fill('Observatory');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(
    page.getByRole('application', { name: 'Observatory interactive architecture' })
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Narrow screens keep the sheet in the bar; the corner toggle belongs to the desktop shell.
  await expect(navToggle(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open perspectives' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  await page.screenshot({ path: 'artifacts/narrow-browser.png' });
});

test('render and export refuse a stale source revision; invalid scopes fail', async ({
  request
}) => {
  const loaded = await (await request.get('/api/models/delivery')).json();
  const state = { expanded: [], proposed: false, lens: 'structure' };
  for (const path of ['/api/render', '/api/export']) {
    const r = await request.post(path, { data: { model: 'delivery', state, revision: 'stale' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toContain('changed on disk');
  }
  const r = await request.post('/api/render', {
    data: { model: 'delivery', state: { ...state, scope: 'missing' }, revision: loaded.revision }
  });
  expect(r.status()).toBe(400);
});

test('animation has intermediate geometry and rapid scene changes settle to latest', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Expand Delivery Operations', exact: true }).click();
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-node-id="core.shipments"]');
    const opacity = Number(e?.getAttribute('opacity'));
    return opacity > 0 && opacity < 1;
  });
  await page.waitForFunction(
    () => document.querySelector('[data-node-id="core.shipments"]')?.getAttribute('opacity') === '1'
  );
  await page.getByRole('button', { name: '03 Where responsibility changes' }).click();
  await page.getByRole('button', { name: '01 The big picture' }).click();
  await ready(page);
  await expect(sceneTitle(page)).toHaveText('The big picture');
  await expect(page.locator('[data-node-id="core.shipments"]')).toHaveCount(0);
});

test('inspector preserves current/proposed distinction for hidden children and connections', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-node-id="intake"]').click();
  await expect(
    page.locator('.inspector .child-link').filter({ hasText: 'Marketplace' })
  ).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Proposed' }).check();
  await ready(page);
  await expect(
    page.locator('.inspector .child-link').filter({ hasText: 'Marketplace' })
  ).toContainText('Proposed');
});

test('download errors remain visible inside the export dialog', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.export-preview img')).toBeVisible();
  await page.route('**/api/export', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'The model changed on disk. Reload the model.' })
    })
  );
  await page.getByRole('button', { name: /Vector SVG/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('changed on disk');
  await expect(page.getByRole('button', { name: /Vector SVG/ })).toBeEnabled();
});

test('canvas prevents drag selection and outline recovers offscreen nodes; sidebar is collapsible', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await expect(page.getByText('One model. Many perspectives.')).toHaveCount(0);
  await expect(page.getByText('Local, authored model')).toHaveCount(0);
  const canvas = page.locator('.canvas');
  expect(await canvas.evaluate((e) => getComputedStyle(e).userSelect)).toBe('none');
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + openCanvas.x, b.y + openCanvas.y);
  await page.mouse.down();
  await page.mouse.move(b.x + openCanvas.x + 420, b.y + openCanvas.y + 40, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.locator('.tree-title').filter({ hasText: 'Customer outcomes' }).click();
  await expect(page.locator('.inspector h2')).toHaveText('Customer outcomes');
  await expect
    .poll(async () => {
      const a = (await canvas.boundingBox())!,
        n = (await page.locator('[data-node-id="outputs"]').boundingBox())!;
      return (
        n.x >= a.x &&
        n.x + n.width <= a.x + a.width &&
        n.y >= a.y &&
        n.y + n.height <= a.y + a.height
      );
    })
    .toBe(true);
  expect(
    await page.locator('.inspector h2').evaluate((e) => getComputedStyle(e).userSelect)
  ).not.toBe('none');
  await page.locator('.inspector h2').dblclick({ position: { x: 30, y: 12 } });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('Customer');
  // The canvas is full bleed under the floating chrome: hiding navigation uncovers diagram
  // room without resizing or refitting the drawing surface itself.
  const width = (await canvas.boundingBox())!.width;
  const covered = (await page.locator('#fractal-sidebar').boundingBox())!.width;
  expect(covered).toBeGreaterThan(0);
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(navToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(navToggle(page)).toHaveAttribute('aria-label', 'Show navigation');
  expect((await canvas.boundingBox())!.width).toBe(width);
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(navToggle(page)).toHaveAttribute('aria-expanded', 'true');
});

test('the navigation panel folds to its grip and closes from it', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sidebar = page.locator('#fractal-sidebar');
  const grip = sidebar.locator('.panel-grip[data-panel-grip]');
  const tall = (await sidebar.boundingBox())!.height;
  await expect(grip.locator('.panel-shade-label')).toHaveText('Navigation');
  // A double-click on the grip folds the panel to a title strip, Mac OS 9 style, and back.
  await grip.dblclick({ position: { x: 70, y: 12 } });
  await expect(sidebar).toHaveClass(/shaded/);
  await expect.poll(async () => (await sidebar.boundingBox())!.height).toBeLessThan(tall / 2);
  await expect(grip.locator('.panel-shade-label')).toBeVisible();
  await expect(page.locator('.tree-title').first()).toBeHidden();
  await grip.dblclick({ position: { x: 70, y: 12 } });
  await expect(sidebar).not.toHaveClass(/shaded/);
  await expect.poll(async () => (await sidebar.boundingBox())!.height).toBe(tall);
  // The grip also carries the panel's own close control, which is the same preference.
  const close = (await grip.locator('.panel-close').boundingBox())!;
  await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fractal.sidebarCollapsed'))).toBe('true');
});

test('the inspector panel folds to its grip and its close control is in the grip', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-node-id="core"]').click();
  const shell = page.locator('.inspector-shell');
  await expect(shell).toBeVisible();
  const grip = shell.locator('.panel-grip[data-panel-grip]');
  await expect(grip.locator('.panel-shade-label')).toHaveText('Delivery Operations');
  // The close control moved out of the inspector's own content and into the panel's grip.
  await expect(
    page.getByRole('complementary', { name: 'Selection details' }).getByRole('button', {
      name: 'Close inspector'
    })
  ).toHaveCount(0);
  await expect(grip.getByRole('button', { name: 'Close inspector' })).toBeVisible();
  const tall = (await shell.boundingBox())!.height;
  await grip.dblclick({ position: { x: 70, y: 12 } });
  await expect(shell).toHaveClass(/shaded/);
  await expect.poll(async () => (await shell.boundingBox())!.height).toBeLessThan(tall / 2);
  await expect(page.locator('.inspector')).toBeHidden();
  await grip.dblclick({ position: { x: 70, y: 12 } });
  await expect(page.locator('.inspector h2')).toHaveText('Delivery Operations');
  const close = (await grip.locator('.panel-close').boundingBox())!;
  await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
  await expect(page.locator('.inspector')).toHaveCount(0);
});

test('the inspector reopens where it was dragged, after closing and after a reload', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-node-id="core"]').click();
  const shell = page.locator('.inspector-shell');
  const grip = shell.locator('.panel-grip[data-panel-grip]');
  await expect(grip.locator('.panel-shade-label')).toHaveText('Delivery Operations');
  await page.waitForTimeout(300);
  const home = (await shell.boundingBox())!;
  const from = (await grip.boundingBox())!;
  await page.mouse.move(from.x + 70, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 70 - 180, from.y + 12 + 120, { steps: 6 });
  await page.mouse.up();
  const moved = (await shell.boundingBox())!;
  expect(moved.x - home.x).toBeCloseTo(-180, 0);
  expect(moved.y - home.y).toBeCloseTo(120, 0);
  // The nudge is personal chrome, stored with the panel's size.
  expect(await page.evaluate(() => localStorage.getItem('fractal.panelOffset.inspector'))).toBe(
    JSON.stringify({ x: -180, y: 120 })
  );
  // Closing and selecting again brings the panel back to the same place.
  await grip.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.locator('[data-node-id="intake"]').click();
  await expect(shell.locator('.panel-shade-label')).toHaveText('Order intake');
  await page.waitForTimeout(300);
  const reopened = (await shell.boundingBox())!;
  expect(reopened.x).toBeCloseTo(moved.x, 0);
  expect(reopened.y).toBeCloseTo(moved.y, 0);
  // So does the next visit, which reopens on the same selection.
  await page.reload();
  await ready(page);
  await expect(shell.locator('.panel-shade-label')).toHaveText('Order intake');
  await page.waitForTimeout(300);
  const restored = (await shell.boundingBox())!;
  expect(restored.x).toBeCloseTo(moved.x, 0);
  expect(restored.y).toBeCloseTo(moved.y, 0);
  // A window too small for the remembered place keeps the panel reachable.
  await page.setViewportSize({ width: 900, height: 420 });
  await page.waitForTimeout(100);
  const studio = (await page.locator('.studio').boundingBox())!;
  const squeezed = (await shell.boundingBox())!;
  expect(squeezed.y).toBeLessThan(studio.height - 48);
  expect(squeezed.x + squeezed.width).toBeGreaterThan(72);
});

test('the selection survives a refresh and leaves the link when the inspector closes', async ({
  page
}) => {
  await page.goto('/?model=delivery&scene=execution');
  await ready(page);
  await page.locator('[data-node-id="core.floor"]').click();
  await expect(page.locator('.inspector h2')).toHaveText('Warehouse floor');
  await expect(page).toHaveURL(/selected=core\.floor/);
  await page.reload();
  await ready(page);
  await expect(page.locator('.inspector h2')).toHaveText('Warehouse floor');
  await expect(page.locator('.inspector .kind')).toHaveAttribute('data-kind', 'subsystem');
  // A connection comes back as a connection.
  const edge = page.locator('[data-edge-id]').first();
  await edge.click();
  await expect(page.locator('.inspector .kind')).toHaveAttribute('data-kind', 'relationship');
  await expect(page).toHaveURL(/selected=/);
  await page.reload();
  await ready(page);
  await expect(page.locator('.inspector .kind')).toHaveAttribute('data-kind', 'relationship');
  await expect(page.locator('[data-edge-id].selected')).toHaveCount(1);
  // Closing the inspector takes the selection out of the link, so a refresh stays closed.
  await page.locator('.inspector-shell').getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).not.toHaveURL(/selected=/);
  await page.reload();
  await ready(page);
  await expect(page.locator('.inspector')).toHaveCount(0);
  // A selection the view no longer shows is dropped rather than inspected blind.
  await page.goto('/?model=delivery&scene=overview&selected=core.floor');
  await ready(page);
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page).not.toHaveURL(/selected=/);
});

test('a drag pans from anywhere, including a node, while a still click still selects', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(600);
  const node = page.locator('[data-node-id="core"]');
  const camera = () =>
    node.evaluate((element) => {
      const matrix = (element.parentElement as unknown as SVGGraphicsElement).getScreenCTM()!;
      return { x: matrix.e, y: matrix.f };
    });
  const before = await camera();
  const box = (await node.boundingBox())!;
  // Pressing on the node and dragging pans the camera rather than selecting the node.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height - 12 + 40, { steps: 8 });
  await page.mouse.up();
  const panned = await camera();
  expect(panned.x - before.x).toBeCloseTo(90, 0);
  expect(panned.y - before.y).toBeCloseTo(40, 0);
  await expect(page.locator('.inspector')).toHaveCount(0);
  // A press that does not travel keeps its target and selects it.
  await page.mouse.click(box.x + box.width / 2 + 90, box.y + box.height - 12 + 40);
  await expect(page.locator('.inspector h2')).toHaveText('Delivery Operations');
});

test('a hidden sidebar stays hidden across reloads and on the sequence surface', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fractal.sidebarCollapsed'))).toBe('true');
  await page.reload();
  await ready(page);
  // The collapsed class is stamped before first paint, so the panel never flashes back.
  await expect(page.locator('.studio')).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  // The preference is chrome, not a perspective, so it never enters the shared link.
  expect(new URL(page.url()).searchParams.has('sidebar')).toBe(false);
  await page.goto('/sequence?model=delivery&journey=order-delivery');
  await expect(
    page.getByRole('application', { name: 'Interactive sequence diagram' })
  ).toBeVisible();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.goto('/');
  await ready(page);
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('left navigation owns view controls and remembers section disclosure', async ({ page }) => {
  await page.goto('/?model=delivery&scene=overview');
  await ready(page);
  await expect(
    page.locator('.appbar').getByRole('navigation', { name: 'Project views' })
  ).toHaveCount(0);
  await expect(page.locator('.view-toolbar')).toHaveCount(0);
  await expect(
    page.locator('.sidebar').getByRole('navigation', { name: 'Project views' })
  ).toHaveCount(0);
  const trust = page.locator('.sidebar').getByRole('checkbox', { name: 'Trust' });
  const proposed = page.locator('.sidebar').getByRole('checkbox', { name: 'Proposed' });
  await expect(trust).not.toBeChecked();
  await expect(proposed).not.toBeChecked();
  await trust.check();
  await ready(page);
  await expect(trust).toBeChecked();
  expect(JSON.parse(new URL(page.url()).searchParams.get('view')!).lens).toBe('trust');
  await proposed.check();
  await ready(page);
  expect(JSON.parse(new URL(page.url()).searchParams.get('view')!).proposed).toBe(true);
  await trust.uncheck();
  await ready(page);
  await expect(trust).not.toBeChecked();
  expect(JSON.parse(new URL(page.url()).searchParams.get('view')!).lens).toBe('structure');

  const perspectives = page.getByRole('button', { name: /PERSPECTIVES/ });
  const sequences = page.getByRole('button', { name: /SEQUENCES/ });
  await perspectives.click();
  await sequences.click();
  await expect(perspectives).toHaveAttribute('aria-expanded', 'false');
  await expect(sequences).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('navigation', { name: 'Saved perspectives' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sequence journeys' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('navigationSection')).toBe(false);

  await page.reload();
  await ready(page);
  await expect(page.getByRole('button', { name: /PERSPECTIVES/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(page.getByRole('button', { name: /SEQUENCES/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

test('spatial arrows focus, Enter inspects, Space expands and Escape goes outward', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  const canvas = page.getByRole('application');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-node-id')))
    .toBeTruthy();
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-node-id'));
  expect(first).toBeTruthy();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-node-id')))
    .not.toBe(first);
  const second = await page.evaluate(() => document.activeElement?.getAttribute('data-node-id'));
  expect(second).not.toBe(first);
  const scale = () =>
    page
      .locator(`[data-node-id="${second}"]`)
      .evaluate((element) => (element as SVGGraphicsElement).getScreenCTM()!.a);
  const fitted = await scale();
  await page.keyboard.press('=');
  await expect.poll(scale).toBeGreaterThan(fitted);
  const fit = page.getByRole('button', { name: 'Fit diagram', exact: true });
  await fit.focus();
  await page.keyboard.press('ArrowRight');
  await expect(fit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(scale).toBeCloseTo(fitted, 3);
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.locator(`[data-node-id="${second}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector')).toBeVisible();
  const edge = page.locator('.edge').first();
  const edgeTitle = (await edge.getAttribute('aria-label'))!.split(':')[0];
  await edge.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector h2')).toHaveText(edgeTitle);
  await page.locator('.tree-title').filter({ hasText: 'Delivery Operations' }).click();
  await expect(page.locator('[data-node-id="core"]')).toBeFocused();
  await page.keyboard.press('Space');
  await ready(page);
  await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
  await page.locator('[data-node-id="core.shipments"]').focus();
  await page.keyboard.press('Escape');
  await ready(page);
  await expect(page.locator('[data-node-id="core.shipments"]')).toHaveCount(0);
  await expect(page.locator('[data-node-id="core"]')).toBeFocused();
  await scene(page, '02 Inside delivery operations');
  await page.getByRole('application').focus();
  await page.keyboard.press('Escape');
  await ready(page);
  await expect(page.locator('[data-node-id="intake"]')).toBeVisible();
});

test('delayed peek is read-only, cancels, and respects proposal visibility', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const plus = page.getByRole('button', { name: 'Expand Order intake', exact: true });
  const url = page.url();
  await plus.hover();
  await page.waitForTimeout(400);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.getByRole('tooltip')).not.toContainText('Marketplace');
  await expect(page.locator('[data-node-id]')).toHaveCount(5);
  expect(page.url()).toBe(url);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(page.url()).toBe(url);
  await page.getByRole('checkbox', { name: 'Proposed' }).check();
  await ready(page);
  await plus.hover();
  await expect(page.getByRole('tooltip')).toContainText('Marketplace');
  await page.mouse.move(10, 10);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await plus.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.locator('[data-node-id="intake.events"]')).toBeVisible();
});

test('themes survive scene changes, URL restoration, and exported presentation', async ({
  page
}) => {
  await page.goto('/?model=delivery&scene=execution');
  await ready(page);
  await expect(sceneTitle(page)).toHaveText('Inside delivery operations');
  for (const theme of ['Graphite', 'Midnight', 'Grove'] as const) {
    await chooseTheme(page, theme);
    await ready(page);
    await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', theme.toLowerCase());
    await page.screenshot({ path: `artifacts/${theme.toLowerCase()}-studio.png` });
  }
  await chooseTheme(page, 'Midnight');
  await ready(page);
  await scene(page, '03 Where responsibility changes');
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'midnight');
  // The last theme is a cookie, so the server renders the next load in it without a flash.
  expect(await page.evaluate(() => document.cookie)).toContain('fractal.theme=midnight');
  await page.reload();
  await ready(page);
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'midnight');
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: /^Midnight/ })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await page.keyboard.press('Escape');
  await scene(page, '04 The next chapter');
  const loaded = await (await page.request.get('/api/models/delivery')).json();
  const proposedColor = loaded.model.elements.find(
    (e: { id: string }) => e.id === 'outputs.courier'
  ).color;
  await expect(page.locator('[data-node-id="outputs.courier"] > rect').first()).toHaveAttribute(
    'stroke',
    proposedColor
  );
  // The corner controls are one card in the theme's colours, with no resting border.
  const card = (selector: string) =>
    page.locator(selector).evaluate((e) => {
      const style = getComputedStyle(e);
      return { background: style.backgroundColor, border: style.borderTopColor };
    });
  expect(await card('.fit-control')).toEqual(await card('.nav-toggle-corner'));
  expect((await card('.fit-control')).background).toBe('rgb(29, 37, 34)');
  expect((await card('.fit-control')).border).toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  expect(
    await page
      .locator('.presentation-controls')
      .evaluate((e) => getComputedStyle(e).backgroundColor)
  ).not.toContain('255, 255, 255');
  await page.screenshot({ path: 'artifacts/midnight-presentation.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.export-preview img')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /Vector SVG/ }).click();
  const file = await pending;
  expect(await readFile((await file.path())!, 'utf8')).toContain('data-theme="midnight"');
});

test('jump searches hidden components, proposed connections, and saved views', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('combobox', {
    name: 'Search projects, components, connections, views and sequences'
  });
  await expect(search).toBeFocused();
  await search.fill('Carrier gateway');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('.inspector h2')).toHaveText('Carrier gateway');
  await expect(page.locator('[data-node-id="core.carrier"]')).toBeFocused();
  await page.keyboard.press('Meta+k');
  await search.fill('Allow courier dispatch');
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText('Proposed');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('.inspector h2')).toHaveText('Allow courier dispatch');
  await expect(page.getByRole('checkbox', { name: 'Proposed' })).toBeChecked();
  await expect(page.locator('[data-node-id="outputs.courier"]')).toBeVisible();
  const edge = page.locator('.edge.selected');
  await expect(edge).toBeFocused();
  const geometry = await edge.boundingBox(),
    area = await page.locator('.canvas').boundingBox();
  expect(geometry!.x).toBeGreaterThanOrEqual(area!.x - 1);
  expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(area!.x + area!.width + 1);
  await page.keyboard.press('Meta+k');
  await search.fill('Where responsibility changes');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(sceneTitle(page)).toHaveText('Where responsibility changes');
  await page.keyboard.press('Meta+k');
  await search.fill('no such component zxqv');
  await expect(page.getByText('No matches.', { exact: false })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('shortcut sheet, global commands, and presenter component traversal use the registry', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('application').focus();
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  // Escape and a click outside close the sheet; it carries no close button of its own.
  await expect(page.getByRole('dialog').getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/shortcut-sheet.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  await page.keyboard.press('Meta+b');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await page.keyboard.press('Meta+b');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.presentation-controls')).toBeVisible();
  await page.keyboard.press('h');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-node-id')))
    .toBeTruthy();
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-node-id'));
  await page.keyboard.press('l');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-node-id')))
    .not.toBe(first);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The big picture');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox').fill('Delivery Operations');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('[data-node-id="core"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
  await page.keyboard.press('Backspace');
  await ready(page);
  await expect(page.locator('[data-node-id="core.shipments"]')).toHaveCount(0);
  await expect(page.locator('.presentation-controls')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inside delivery operations');
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation-controls')).toHaveCount(0);
});

test('the floating bar carries the title and actions over a full-bleed canvas', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await ready(page);
  // The bar is air: only its two clusters take the pointer, the canvas shows between them.
  const appbar = page.locator('header.appbar');
  expect(await appbar.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  expect(
    await page
      .locator('.appbar > *')
      .evaluateAll((nodes) =>
        nodes.map(
          (n) =>
            ['appbar-breadcrumb', 'mobile-menu', 'top-actions'].find((name) =>
              n.classList.contains(name)
            ) ?? n.className
        )
      )
  ).toEqual(['appbar-breadcrumb', 'mobile-menu', 'top-actions']);
  // The old grid chrome is gone; nothing replaced it inside the bar.
  for (const gone of [
    '.appbar-leading',
    '.sidebar-switch',
    '.theme-picker',
    '.select-control',
    '.layout-switch',
    '.view-toolbar',
    '.appbar .wordmark'
  ])
    expect(await page.locator(gone).count()).toBe(0);
  expect(
    await page
      .locator('.top-actions > *')
      .evaluateAll((nodes) =>
        nodes.map(
          (n) =>
            n.getAttribute('aria-label') ??
            n.querySelector('button')?.getAttribute('aria-label') ??
            n.textContent?.trim()
        )
      )
  ).toEqual([
    'Copy view link',
    'Keyboard Shortcuts',
    'Export',
    'Flow top to bottom',
    'Theme',
    'Present',
    'Switch project: Fictional Delivery Service'
  ]);
  // The canvas heading only returns for presentations; the bar states where the reader is.
  const heading = page.locator('.composition-heading');
  expect(await heading.evaluate((element) => getComputedStyle(element).display)).toBe('none');
  const location = page.getByRole('navigation', { name: 'Current location' });
  await expect(sceneTitle(page)).toHaveText('The big picture');
  await expect(location.locator('.appbar-subtitle')).toContainText('Five parts');
  await page.getByRole('button', { name: 'Expand Delivery Operations', exact: true }).click();
  await ready(page);
  await page.locator('[data-node-id="core"]').click();
  await page.getByRole('button', { name: 'Focus this component' }).click();
  await ready(page);
  // Focused element follows the scene, after a chevron, and the subtitle stays last.
  await expect(sceneTitle(page)).toHaveText('The big picture');
  await expect(location.getByRole('button', { name: 'Delivery Operations' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(location.locator('.appbar-subtitle')).toBeVisible();
  expect(
    await location.evaluate(
      (nav) =>
        nav
          .querySelector('.crumb-scene')!
          .compareDocumentPosition(nav.querySelector('.appbar-subtitle')!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    )
  ).toBeTruthy();

  // Chrome floats over the canvas, so opening and closing it never resizes the drawing surface.
  const studio = (await page.locator('.studio').boundingBox())!;
  const canvas = (await page.locator('.canvas').boundingBox())!;
  expect(canvas.width).toBe(studio.width);
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  expect((await page.locator('.canvas').boundingBox())!.width).toBe(canvas.width);
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await navToggle(page).click();
  expect(
    await page.locator('.studio').evaluate((e) => getComputedStyle(e).transitionDuration)
  ).toBe('0s');
  await page.screenshot({ path: 'artifacts/compact-studio.png' });
});

test('the canvas corners hold the wordmark, navigation toggle, zoom and legend', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  const studio = (await page.locator('.studio').boundingBox())!;
  const near = (value: number, edge: number) => Math.abs(value - edge) < 40;
  const wordmark = (await page.locator('.wordmark-corner').boundingBox())!;
  const toggle = (await navToggle(page).boundingBox())!;
  const tools = (await page.locator('.fit-control').boundingBox())!;
  const legend = (await page.locator('.diagram-info-control').boundingBox())!;
  expect(near(wordmark.x + wordmark.width, studio.width)).toBe(true);
  expect(near(wordmark.y + wordmark.height, studio.height)).toBe(true);
  expect(near(toggle.x, 0)).toBe(true);
  expect(near(toggle.y + toggle.height, studio.height)).toBe(true);
  // Zoom sits beside the toggle; the legend sits inboard of the wordmark.
  expect(tools.x).toBeGreaterThan(toggle.x + toggle.width);
  expect(legend.x + legend.width).toBeLessThanOrEqual(wordmark.x + 1);
  expect(Math.abs(tools.y - toggle.y)).toBeLessThan(2);
  expect(Math.abs(legend.y - wordmark.y)).toBeLessThan(2);
  // ⌘B still toggles navigation, and the corner control reports the same state.
  await page.keyboard.press('Meta+b');
  await expect(navToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(navToggle(page)).toHaveAttribute('aria-controls', 'fractal-sidebar');
  await page.keyboard.press('Meta+b');
  await expect(navToggle(page)).toHaveAttribute('aria-expanded', 'true');
});

test('the wordmark flyout preserves its flourish and exposes Fractal links accessibly', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await ready(page);
  const trigger = page.getByRole('button', { name: 'About Fractal', exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.hover();
  const menu = page.getByRole('menu', { name: 'Fractal links' });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveCSS('opacity', '1');
  await expect(trigger).toHaveCSS('animation-name', 'wordmark-wave');
  await expect(menu.getByRole('menuitem', { name: /Source on GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/marcus/fractal'
  );
  await expect(menu.getByRole('menuitem', { name: /Made by Haplab/ })).toHaveAttribute(
    'href',
    'https://haplab.com'
  );

  await page.mouse.move(700, 400);
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.mouse.move(700, 400);
  await trigger.hover();
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.mouse.move(700, 400);
  await trigger.hover();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Meta+k');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Jump to' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Jump to' })).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.hover();
  await expect(trigger).toHaveCSS('animation-name', 'none');
  expect(await trigger.evaluate((element) => getComputedStyle(element).filter)).not.toBe('none');
  await page.mouse.click(700, 400);
  await expect(menu).toHaveCount(0);

  await chooseTheme(page, 'Midnight');
  await ready(page);
  await trigger.click();
  const colors = await menu.evaluate((element) => {
    const expected = document.createElement('i');
    expected.style.background = 'color-mix(in srgb, var(--ui-card, #fcfdf9) 96%, transparent)';
    element.append(expected);
    const result = {
      actual: getComputedStyle(element).backgroundColor,
      expected: getComputedStyle(expected).backgroundColor
    };
    expected.remove();
    return result;
  });
  expect(colors.actual).toBe(colors.expected);
  expect(colors.actual).not.toBe('rgba(0, 0, 0, 0)');
  await page.mouse.click(700, 400);
  await expect(menu).toHaveCount(0);
});

test.describe('wordmark touch', () => {
  test.use({ hasTouch: true });

  test('the flyout remains reachable on a phone-sized canvas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await ready(page);
    const trigger = page.getByRole('button', { name: 'About Fractal', exact: true });
    await expect(trigger).toBeVisible();
    await trigger.tap();
    await expect(page.getByRole('menu', { name: 'Fractal links' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
});

test('header breadcrumbs zoom outward and the sidebar width is durable', async ({ page }) => {
  const focused = encodeURIComponent(
    JSON.stringify({
      expanded: ['core'],
      proposed: false,
      lens: 'structure',
      scope: 'core.shipments'
    })
  );
  await page.goto(`/?model=delivery&scene=overview&view=${focused}`);
  await ready(page);

  const location = page.getByRole('navigation', { name: 'Current location' });
  await expect(location).toContainText('The big picture');
  await expect(location).toContainText('Delivery Operations');
  await expect(location).toContainText('Shipment lifecycle');
  await location.getByRole('button', { name: 'Delivery Operations' }).click();
  await ready(page);
  expect(JSON.parse(new URL(page.url()).searchParams.get('view')!).scope).toBe('core');
  await location.getByRole('button', { name: 'The big picture' }).click();
  await ready(page);
  expect(new URL(page.url()).searchParams.get('scene')).toBe('overview');

  const sidebar = page.locator('#fractal-sidebar');
  const resizer = page.getByRole('separator', { name: 'Resize navigation' });
  const before = (await sidebar.boundingBox())!.width;
  const handle = (await resizer.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 44, handle.y + 100, { steps: 4 });
  await expect(page.locator('.studio')).toHaveClass(/sidebar-resizing/);
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(before + 20);
  await page.mouse.up();
  const resized = (await sidebar.boundingBox())!.width;
  expect(await page.evaluate(() => localStorage.getItem('fractal.sidebarWidth'))).toBe(
    String(Math.round(resized))
  );
  await page.reload();
  await ready(page);
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(resized, 0);

  await resizer.focus();
  await page.keyboard.press('Home');
  await expect(resizer).toHaveAttribute('aria-valuenow', '180');
  expect(await page.evaluate(() => localStorage.getItem('fractal.sidebarWidth'))).toBe('180');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(resizer).toHaveAttribute('aria-valuenow', '348');
  expect(await page.evaluate(() => localStorage.getItem('fractal.sidebarWidth'))).toBe('348');

  await page.goto('/sequence?model=delivery&journey=order-delivery');
  await expect(
    page.getByRole('application', { name: 'Interactive sequence diagram' })
  ).toBeVisible();
  await expect
    .poll(async () => (await page.locator('#fractal-sidebar').boundingBox())!.width)
    .toBeCloseTo(348, 0);
});

test('presenter exploration preserves the story position and help matches its mode', async ({
  page
}) => {
  await page.goto('/?model=delivery&scene=trust');
  await ready(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.locator('[data-node-id="core"]').focus();
  await page.keyboard.press('Space');
  await ready(page);
  await page.keyboard.press('ArrowRight');
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The next chapter');
  await page.locator('[data-node-id="outputs"]').focus();
  await page.keyboard.press('Backspace');
  await ready(page);
  await page.keyboard.press('ArrowLeft');
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where responsibility changes');
  await expect(page.locator('#canvas-help')).toContainText(
    'Inspect connection / toggle component: Enter'
  );
  await expect(page.locator('#canvas-help')).toContainText('Exit presentation: Esc');
  await page.keyboard.press('?');
  await expect(
    page.locator('.shortcut-row').filter({ hasText: 'Inspect connection / toggle component' })
  ).toContainText('Enter');
  const left = page.locator('.shortcut-row').filter({ hasText: 'Move focus left' });
  await expect(left).toContainText('H');
  await expect(left).not.toContainText('←');
  await expect(page.locator('.shortcut-row').filter({ hasText: 'Previous scene' })).toContainText(
    '←'
  );
  await page.screenshot({ path: 'artifacts/presentation-shortcuts.png' });
});

test('relationship and native input focus do not mutate previously focused components', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-node-id="core"]').focus();
  await page.locator('[data-edge-id]').first().focus();
  const before = page.url();
  await page.keyboard.press('Space');
  await page.keyboard.press('Backspace');
  expect(page.url()).toBe(before);
  await expect(page.locator('[data-node-id="core.shipments"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Theme', exact: true }).focus();
  await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'Theme', exact: true })).toBeFocused();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', {
    name: 'Search projects, components, connections, views and sequences'
  });
  await search.fill('wasd hjkl ?');
  await page.keyboard.press('Control+b');
  await expect(search).toBeVisible();
  await expect(page.locator('.studio')).not.toHaveClass(/sidebar-collapsed/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('application').focus();
  const scale = () =>
    page
      .locator('[data-node-id="core"]')
      .evaluate((element) => (element as SVGGraphicsElement).getScreenCTM()!.a);
  const fit = await scale();
  await page.keyboard.press('+');
  await expect.poll(scale).toBeGreaterThan(fit);
  await page.keyboard.press('0');
  await expect.poll(scale).toBeCloseTo(fit, 3);
});

test('a stale jump cannot steal selection or focus from a newer scene', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending!: () => void;
  const started = new Promise<void>((resolve) => {
    pending = resolve;
  });
  await page.route('**/api/render', async (route) => {
    const body = route.request().postDataJSON();
    if (body.state.expanded.includes('core') && body.state.lens === 'structure') {
      const response = await route.fetch();
      pending();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.keyboard.press('Meta+k');
  await page
    .getByRole('combobox', {
      name: 'Search projects, components, connections, views and sequences'
    })
    .fill('Carrier gateway');
  await page.keyboard.press('Enter');
  await started;
  await scene(page, '03 Where responsibility changes');
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(sceneTitle(page)).toHaveText('Where responsibility changes');
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page.locator('[data-node-id="core.carrier"]')).not.toBeFocused();
});

test('jump and shortcut dialogs fit a narrow screen in Midnight', async ({ page }) => {
  // The bar drops its icon controls on a phone, so the palette is chosen on the desktop shell
  // and carried over in the cookie the server renders from.
  await page.goto('/');
  await ready(page);
  await chooseTheme(page, 'Midnight');
  await ready(page);
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'midnight');
  await page.keyboard.press('Meta+k');
  await page
    .getByRole('combobox', {
      name: 'Search projects, components, connections, views and sequences'
    })
    .fill('work');
  for (const kind of ['jump', 'help']) {
    if (kind === 'help') {
      await page.keyboard.press('Escape');
      await page.getByRole('application').focus();
      await page.keyboard.press('?');
    }
    const dialog = page.getByRole('dialog');
    const box = (await dialog.boundingBox())!;
    const footer = (await dialog.locator('footer').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(footer.y + footer.height).toBeLessThanOrEqual(box.y + box.height);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      'rgb(255, 255, 255)'
    );
    await page.screenshot({ path: `artifacts/midnight-${kind}-narrow.png` });
  }
});

test('a pending outward transition cannot move focus after the presenter advances', async ({
  page
}) => {
  await page.goto('/?model=delivery&scene=execution');
  await ready(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.locator('[data-node-id="core.routing"]').focus();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending!: () => void;
  const started = new Promise<void>((resolve) => {
    pending = resolve;
  });
  await page.route('**/api/render', async (route) => {
    const body = route.request().postDataJSON();
    if (!body.state.scope && body.state.lens === 'structure') {
      const response = await route.fetch();
      pending();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.keyboard.press('Backspace');
  await started;
  await page.keyboard.press('ArrowRight');
  await ready(page);
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where responsibility changes');
  await expect(page.locator('[data-node-id="core"]')).not.toBeFocused();
  await expect(page.locator('[data-node-id="core.routing"]')).toBeFocused();
});

test('navigation dialogs dismiss only gestures on their backdrop', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  for (const key of ['Meta+k', '?']) {
    await page.getByRole('application').focus();
    await page.keyboard.press(key);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Neither dialog has a close button; a click inside, on its heading or its search, stays.
    await dialog.locator('h2, input').first().click();
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(8, 8);
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(dialog).toHaveCount(0);
  }
});

test('diagram information replaces the footer without losing boundaries or external connections', async ({
  page
}) => {
  await page.goto('/?model=delivery&scene=trust');
  await ready(page);
  await expect(page.locator('.composition-footer, .boundary-legend, .alpha')).toHaveCount(0);
  const key = page.getByRole('button', { name: 'Diagram key', exact: true });
  const keyBox = (await key.boundingBox())!;
  const zoomBox = (await page.locator('.fit-control').boundingBox())!;
  expect(Math.abs(keyBox.y + keyBox.height / 2 - zoomBox.y - zoomBox.height / 2)).toBeLessThan(2);
  await page.getByRole('application').focus();
  const before = page.url();
  await page.keyboard.press('i');
  await expect(page.getByRole('region', { name: 'Diagram key' })).toBeVisible();
  await expect(page.locator('#diagram-key')).toContainText('Managed operations');
  await expect(page.locator('#diagram-key')).toContainText('Outlines show exact membership');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Diagram key' })).not.toBeVisible();
  expect(page.url()).toBe(before);
  await key.click();
  await page.mouse.click(10, 80);
  await expect(page.locator('#diagram-key')).not.toBeVisible();
  await key.click();
  await page.getByRole('button', { name: /external connections/ }).click();
  await expect(page.locator('.inspector h2')).toHaveText('Connected beyond this view');
});

test('the inspector floats in over a still canvas, respects reduced motion and keeps type quiet', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await ready(page);
  const before = (await page.locator('.canvas').boundingBox())!.width;
  await page.locator('[data-node-id="core"]').click();
  const shell = page.locator('.inspector-shell');
  await expect(shell).toBeVisible();
  // The inspector is a card over the canvas: it arrives at its own width and resizes nothing.
  await expect.poll(async () => (await shell.boundingBox())!.width).toBeCloseTo(284, 0);
  const studio = (await page.locator('.studio').boundingBox())!;
  const box = (await shell.boundingBox())!;
  expect(studio.width - (box.x + box.width)).toBeLessThan(40);
  expect((await page.locator('.canvas').boundingBox())!.width).toBe(before);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  expect((await page.locator('.canvas').boundingBox())!.width).toBe(before);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-node-id="core"]').click();
  await expect
    .poll(() => page.locator('.inspector-shell').evaluate((el) => el.getAnimations().length))
    .toBe(0);
  expect(await page.locator('.inspector h2').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    '16px'
  );
  expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe('17.3px');
  await expect(page.locator('[data-node-id] > rect[width="3"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await chooseTheme(page, 'Midnight');
  await ready(page);
  await page.mouse.move(5, 5);
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  expect(await exportButton.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
    'rgba(0, 0, 0, 0)'
  );
  expect(await exportButton.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('3px');
  await exportButton.hover();
  expect(await exportButton.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
    'rgba(0, 0, 0, 0)'
  );
  await page.getByRole('button', { name: 'Diagram key', exact: true }).click();
  await page.screenshot({ path: 'artifacts/polished-midnight-studio.png' });
});

test('the theme fly-out is a menu of swatches that repaints the studio and is remembered', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'grove');
  const trigger = page.getByRole('button', { name: 'Theme', exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const flyout = page.locator('.theme-flyout');
  await expect(flyout).toHaveRole('menu');
  await expect(flyout.getByRole('menuitemradio')).toHaveCount(3);
  for (const name of ['Grove', 'Graphite', 'Midnight'])
    await expect(flyout.getByRole('menuitemradio', { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(flyout.getByRole('menuitemradio', { name: /^Grove/ })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  // Escape closes without choosing and returns focus to the palette button.
  await page.keyboard.press('Escape');
  await expect(flyout).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'grove');
  await chooseTheme(page, 'Graphite');
  await ready(page);
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'graphite');
  // The choice is a cookie, so the server renders the next page in it — including the sequence
  // studio, which shares the palette without carrying it in the link.
  expect(await page.evaluate(() => document.cookie)).toContain('fractal.theme=graphite');
  await page.goto('/sequence?model=delivery&journey=order-delivery');
  await expect(
    page.getByRole('application', { name: 'Interactive sequence diagram' })
  ).toBeVisible();
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'graphite');
});

test('one project switcher and command search preserve project identity and recover invalid links', async ({
  page
}) => {
  await page.goto('/?model=delivery');
  await ready(page);
  await expect(page.locator('#model-select')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Switch project: Fictional Delivery Service', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Switch project' })).toBeVisible();
  // The switcher opens on the project you are in, not the first name alphabetically.
  const selected = page.getByRole('dialog').getByRole('option', { selected: true });
  await expect(selected).toContainText('Fictional Delivery Service');
  await expect(selected).toContainText('Current project');
  await page.getByRole('combobox', { name: 'Search projects', exact: true }).fill('Observatory');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.getByRole('application')).toHaveAttribute(
    'aria-label',
    'Observatory interactive architecture'
  );
  await expect(page).toHaveURL(/model=observatory/);
  await page.goto('/');
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Switch project: Observatory', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Theme', exact: true }).focus();
  await page.keyboard.press('Meta+Shift+k');
  await expect(page.getByRole('combobox', { name: 'Search projects', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog').getByRole('option', { selected: true })).toContainText(
    'Observatory'
  );
  // Enter on the opening selection stays put rather than switching to the first project.
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page).toHaveURL(/model=observatory/);
  await page.keyboard.press('Meta+Shift+k');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await page
    .getByRole('combobox', {
      name: 'Search projects, components, connections, views and sequences'
    })
    .fill('Fictional Delivery Service');
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText('Project');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.getByRole('application')).toHaveAttribute(
    'aria-label',
    'Fictional Delivery Service interactive architecture'
  );
  await page.goto('/?model=missing-project');
  await expect(page.getByRole('alert')).toContainText('not in the catalog');
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose project' }).click();
  await page
    .getByRole('combobox', { name: 'Search projects', exact: true })
    .fill('Fictional Delivery Service');
  await page.keyboard.press('Enter');
  await ready(page);
});

test('empty and failed catalogs retain a reachable refresh path', async ({ page }) => {
  let state = 'empty';
  await page.route('**/api/models', async (route) => {
    if (state === 'empty') await route.fulfill({ json: [] });
    else if (state === 'invalid')
      await route.fulfill({ status: 400, json: { error: 'Catalog has duplicate IDs' } });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('No projects configured');
  await page.keyboard.press('Meta+Shift+k');
  await expect(page.getByRole('dialog')).toContainText('No projects in this catalog yet');
  state = 'invalid';
  await page.getByRole('button', { name: 'Refresh projects' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('duplicate IDs');
  state = 'valid';
  await page.getByRole('button', { name: 'Refresh projects' }).click();
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Search projects', exact: true }).focus();
  await page.keyboard.press('Enter');
  await ready(page);
  state = 'invalid';
  await page.getByRole('button', { name: /Switch project:/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('duplicate IDs');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert')).toContainText('duplicate IDs');
  await expect(page.getByRole('button', { name: 'Choose project' })).toBeVisible();
  state = 'valid';
  await page.getByRole('button', { name: 'Choose project' }).click();
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByRole('button', { name: /Switch project:/ }).click();
  const box = (await page.getByRole('dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/project-switcher-narrow.png' });
});

test('structure show all preserves scope and nests the outline before sequences', async ({
  page
}) => {
  const view = { expanded: [], scope: 'core', proposed: false, lens: 'structure' };
  await page.goto('/?model=delivery&view=' + encodeURIComponent(JSON.stringify(view)));
  await expect(page.locator('[data-node-id="core"]')).toBeVisible();
  const before = await page.locator('[data-node-id]').count();
  const showAll = page.getByRole('button', { name: 'Show all structure', exact: true });
  await showAll.focus();
  await page.keyboard.press('Enter');
  await expect(showAll).toBeDisabled();
  await expect.poll(async () => page.locator('[data-node-id]').count()).toBeGreaterThan(before);
  const state = JSON.parse(new URL(page.url()).searchParams.get('view')!);
  expect(state.scope).toBe('core');
  expect(state.proposed).toBe(false);
  expect(state.expanded).toContain('core');
  expect(state.expanded).not.toContain('intake');
  expect(
    await page
      .locator('.structure-section')
      .evaluate((el) =>
        Boolean(
          el.compareDocumentPosition(document.querySelector('.sequence-section')!) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      )
  ).toBe(true);
  await page.getByRole('button', { name: /PERSPECTIVES/ }).click();
  await expect(page.getByRole('group', { name: 'Perspective structure' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sequence journeys' })).toBeVisible();
  await page.getByRole('button', { name: /PERSPECTIVES/ }).click();
  await expect(showAll).toBeDisabled();
});

test('show all does not bypass invalid perspective recovery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/?model=delivery&view=' +
      encodeURIComponent(
        JSON.stringify({ expanded: [], scope: 'missing-scope', proposed: false, lens: 'structure' })
      )
  );
  await expect(page.getByRole('alert')).toContainText('Unknown scope');
  await expect(page.getByRole('button', { name: 'Show all structure' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('architecture inspector shares progressive disclosure and resets on selection', async ({
  page
}) => {
  await page.goto('/?model=delivery&scene=execution');
  await ready(page);
  await page.locator('[data-node-id="core.floor"]').click();
  const inspector = page.getByRole('complementary', { name: 'Selection details' });
  // The title line carries the kind as the node's own icon; the readable kind is its name and
  // its tooltip, and current is the default and no longer says anything.
  const kind = inspector.locator('.title-line .kind');
  await expect(kind).toHaveAttribute('aria-label', 'Subsystem');
  await expect(kind).toHaveAttribute('data-kind', 'subsystem');
  await expect(kind).toHaveText('');
  expect(await kind.locator('svg').innerHTML()).toBe(
    await page.locator('[data-node-id="core.floor"] .kind-icon').evaluate((icon) =>
      Array.from(icon.children)
        .filter((child) => child.tagName !== 'rect')
        .map((child) => child.outerHTML)
        .join('')
    )
  );
  await kind.hover();
  await expect(page.getByRole('tooltip')).toContainText('Subsystem');
  await page.mouse.move(10, 10);
  await expect(inspector.getByText('Current', { exact: true })).toHaveCount(0);
  await expect(inspector.getByText('Warehouse work', { exact: true })).toBeVisible();
  const boundary = inspector
    .getByRole('region', { name: 'Boundary membership' })
    .locator('details');
  await expect(boundary).not.toHaveAttribute('open');
  await boundary.locator('summary').press('Space');
  await expect(boundary.locator('p')).toContainText('separate stations');
  expect(await boundary.locator('i').evaluate((el) => el.getBoundingClientRect().width)).toBe(6);
  await inspector.getByRole('button', { name: 'Quality check', exact: true }).click();
  await expect(inspector.locator('.title-line .kind')).toHaveAttribute('aria-label', 'Agent');
  await expect(inspector.getByRole('heading', { level: 2 })).toHaveText('Quality check');
  await expect(inspector.locator('details[open]')).toHaveCount(0);
  const connections = inspector.getByRole('region', { name: 'Connections', exact: true });
  await expect(connections.locator('.route').first()).toBeVisible();
  const connection = connections.locator('.connection-item').first();
  await expect(connection.getByRole('button', { name: /^Inspect / })).toBeVisible();
  await expect(connection.locator('details')).not.toHaveAttribute('open');
  await connection.locator('summary').press('Enter');
  await expect(connection.getByRole('button', { name: /^Inspect / })).toBeVisible();
  await expect(connection.getByText('Endpoints', { exact: true })).toBeVisible();
  const technical = inspector.locator('.secondary details').first();
  const context = inspector.locator('.secondary details').last();
  await expect(technical).not.toHaveAttribute('open');
  await expect(context).not.toHaveAttribute('open');
  await technical.locator('summary').press('Enter');
  await expect(technical.getByText('core.floor.check', { exact: true })).toBeVisible();
  await context.locator('summary').press('Space');
  await expect(context.locator('.context')).toContainText('Fictional example');
  await connection.getByRole('button', { name: /^Inspect / }).click();
  await expect(inspector.getByRole('heading', { level: 2 })).not.toHaveText('Quality check');
  await expect(inspector.locator('details[open]')).toHaveCount(0);
  await expect(inspector.locator('code').first()).toBeHidden();
  await expect(inspector).toBeVisible();
});

test('the Flow control lays the view out top to bottom, by pointer, by key, and on reload', async ({
  page
}) => {
  /** How far apart the nodes sit horizontally against how far apart they sit vertically. */
  const spread = () =>
    page.locator('[data-node-id]').evaluateAll((nodes) => {
      const points = nodes.map((node) => {
        const parts = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute('transform') ?? '');
        return { x: Number(parts![1]), y: Number(parts![2]) };
      });
      const extent = (values: number[]) => Math.max(...values) - Math.min(...values);
      return {
        x: extent(points.map((point) => point.x)),
        y: extent(points.map((point) => point.y))
      };
    });
  const layoutInUrl = () => JSON.parse(new URL(page.url()).searchParams.get('view')!).layout;

  await page.goto('/?model=delivery&scene=overview');
  await ready(page);
  const flow = page.locator('.appbar').getByRole('switch', { name: 'Flow top to bottom' });
  // Flow is a presentation choice, so it lives with the theme, not with the model lenses.
  await expect(page.locator('.sidebar').getByRole('switch')).toHaveCount(0);
  await expect(flow).toHaveAttribute('aria-checked', 'false');
  // The layout lands a frame or two after the busy flag clears, so poll the arrangement.
  const flowsAcross = () =>
    expect.poll(async () => (await spread()).x > (await spread()).y).toBe(true);
  const flowsDown = () =>
    expect.poll(async () => (await spread()).y > (await spread()).x).toBe(true);
  await flowsAcross();
  expect(layoutInUrl()).toBeUndefined();

  await flow.click();
  await ready(page);
  await expect(flow).toHaveAttribute('aria-checked', 'true');
  expect(layoutInUrl()).toBe('elk-layered-down');
  await flowsDown();

  // The link carries the flow: reopening it reproduces the same arrangement.
  await page.reload();
  await ready(page);
  expect(layoutInUrl()).toBe('elk-layered-down');
  await expect(flow).toHaveAttribute('aria-checked', 'true');
  await flowsDown();

  // The registered shortcut is the keyboard path to the same command.
  await page.locator('.canvas > svg').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('f');
  await ready(page);
  await expect(flow).toHaveAttribute('aria-checked', 'false');
  expect(layoutInUrl()).toBeUndefined();
  await flowsAcross();
  await page.keyboard.press('f');
  await ready(page);
  expect(layoutInUrl()).toBe('elk-layered-down');
});

test('a trackpad pinch zooms at a usable pace and a mouse notch keeps its step', async ({
  page
}) => {
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(600);
  const node = page.locator('[data-node-id="core"]');
  const scale = () =>
    node.evaluate(
      (element) => (element.parentElement as unknown as SVGGraphicsElement).getScreenCTM()!.a
    );
  const box = (await page.getByRole('application').boundingBox())!;
  const at = { x: box.x + openCanvas.x, y: box.y + openCanvas.y };
  const cdp = await page.context().newCDPSession(page);
  const before = await scale();
  // One mouse notch is ~100px; it stays at the familiar ~16% step.
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  const notched = await scale();
  expect(notched / before).toBeCloseTo(Math.exp(0.15), 3);
  // A trackpad pinch reaches the canvas as ctrl+wheel with small deltas; ten such frames
  // must move the zoom by a clearly visible amount rather than a crawl.
  for (let i = 0; i < 10; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: at.x,
      y: at.y,
      deltaX: 0,
      deltaY: -5,
      modifiers: 2
    });
  }
  await page.waitForTimeout(100);
  const pinched = await scale();
  expect(pinched / notched).toBeGreaterThan(1.5);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('a two-finger pinch zooms about the fingers and pans with them', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.waitForTimeout(600);
    const node = page.locator('[data-node-id="core"]');
    const transform = () =>
      node.evaluate((element) => {
        const matrix = (element.parentElement as unknown as SVGGraphicsElement).getScreenCTM()!;
        return { scale: matrix.a, x: matrix.e, y: matrix.f };
      });
    const box = (await page.getByRole('application').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    // CDP touch events list the points that changed; a touchEnd lifts exactly the points given.
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { id: number; x: number; y: number }[]
    ) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({ x: box.x + p.x, y: box.y + p.y, id: p.id }))
      });
    const before = await transform();
    const a0 = { id: 0, x: openCanvas.x - 50, y: openCanvas.y },
      b0 = { id: 1, x: openCanvas.x + 50, y: openCanvas.y };
    const mid = { x: box.x + openCanvas.x, y: box.y + openCanvas.y };
    // The world point under the starting midpoint, in the node group's frame.
    const world = { x: (mid.x - before.x) / before.scale, y: (mid.y - before.y) / before.scale };
    await touch('touchStart', [a0]);
    await touch('touchStart', [a0, b0]);
    // Spread the fingers to double the distance while sliding the midpoint 40px right, 20px down.
    const a1 = { id: 0, x: openCanvas.x - 60, y: openCanvas.y + 20 },
      b1 = { id: 1, x: openCanvas.x + 140, y: openCanvas.y + 20 };
    await touch('touchMove', [a1, b1]);
    await page.waitForTimeout(100);
    const pinched = await transform();
    expect(pinched.scale / before.scale).toBeCloseTo(2, 3);
    expect(pinched.x + world.x * pinched.scale).toBeCloseTo(mid.x + 40, 0);
    expect(pinched.y + world.y * pinched.scale).toBeCloseTo(mid.y + 20, 0);
    // Lifting one finger hands over to a plain drag with the other; nothing gets selected.
    await touch('touchEnd', [b1]);
    const a2 = { ...a1, x: a1.x + 30 };
    await touch('touchMove', [a2]);
    await touch('touchEnd', [a2]);
    await page.waitForTimeout(100);
    const dragged = await transform();
    expect(dragged.scale).toBeCloseTo(pinched.scale, 5);
    expect(dragged.x - pinched.x).toBeCloseTo(30, 0);
    await expect(page.locator('.inspector')).toHaveCount(0);
  });
});
