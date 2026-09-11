import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const path = '/sequence?model=delivery&journey=order-delivery';
async function ready(page: Page) {
  await expect(
    page.getByRole('application', { name: 'Interactive sequence diagram' })
  ).toBeVisible();
  await expect(page.getByText('Updating sequence', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-sequence-id]').first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}
const state = (page: Page) => JSON.parse(new URL(page.url()).searchParams.get('seq')!);
/** The theme is a fly-out on the bar now, not a select. */
async function chooseTheme(page: Page, name: 'Grove' | 'Graphite' | 'Midnight') {
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
}
/** Navigation has two hide controls — the canvas corner and the panel grip. This is the corner. */
const navToggle = (page: Page) => page.locator('button.nav-toggle-corner');

test('sequence entry, phase/group folding, original identities and saved view', async ({
  page
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?model=delivery');
  await page.getByRole('navigation', { name: 'Sequence journeys' }).getByRole('link').click();
  await ready(page);
  await expect(page.locator('[data-geometry-kind="column"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Expand all phases', exact: true }).focus();
  await page.keyboard.press('Enter');
  await ready(page);
  expect(state(page).collapsedPhases).toEqual([]);
  await page.getByRole('button', { name: 'Collapse all phases', exact: true }).click();
  await ready(page);
  expect(state(page).collapsedPhases).toHaveLength(5);
  await expect(page.locator('[data-sequence-id="fulfillment"]')).toHaveAttribute(
    'aria-label',
    /collapsed phase/
  );
  await page.getByRole('button', { name: 'Expand Prepare the parcel', exact: true }).click();
  await ready(page);
  await expect(page.locator('[data-sequence-id="summary:packed-parcel"]')).toBeVisible();
  await page.locator('[data-sequence-id="summary:packed-parcel"]').click();
  await expect(page.locator('.inspector')).toContainText('parcel');
  await expect(page.locator('.inspector')).toContainText('picker → shipments');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.getByRole('button', { name: 'Warehouse team lane options', exact: true }).click();
  await page.getByRole('button', { name: 'Separate lanes', exact: true }).click();
  await ready(page);
  await expect(page.locator('[data-geometry-kind="column"]')).toHaveCount(6);
  await expect(page.locator('[data-sequence-id="packed-parcel"]')).toHaveAttribute(
    'data-message-ids',
    'packed-parcel'
  );
  await page.getByRole('button', { name: 'Picker visibility', exact: true }).click();
  await ready(page);
  await expect(page.locator('[data-sequence-id="packed-parcel"]')).toHaveAttribute(
    'aria-label',
    /Omitted interaction/
  );
  expect(
    await page
      .locator('[data-sequence-id="packed-parcel"] text')
      .first()
      .evaluate((el) => getComputedStyle(el).stroke)
  ).toBe('none');
  await expect(
    page.locator('[data-sequence-id="packed-parcel"] path, [data-sequence-id="packed-parcel"] line')
  ).toHaveCount(0);
  await chooseTheme(page, 'Midnight');
  await ready(page);
  const url = page.url();
  await page.reload();
  await ready(page);
  await expect(page).toHaveURL(url);
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'midnight');
  await expect(
    page.getByRole('button', { name: 'Picker visibility', exact: true })
  ).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'artifacts/sequence-browser-detail.png' });
  expect(errors).toEqual([]);
});

test('sequence keyboard, pan then click, phase focus and presentation', async ({ page }) => {
  await page.goto(path);
  await ready(page);
  const canvas = page.getByRole('application');
  await canvas.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-sequence-id="order"]')).toBeFocused();
  await page.keyboard.press('Space');
  await ready(page);
  expect(state(page).collapsedPhases).not.toContain('order');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector')).toContainText('place-order');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 60);
  await page.mouse.up();
  await page.locator('[data-sequence-id="dispatch"]').click();
  await expect(page.locator('.inspector')).toContainText('Dispatch the parcel');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.getByRole('button', { name: 'Show only Pick the order', exact: true }).click();
  await ready(page);
  expect(state(page).visiblePhases).toEqual(['picking']);
  const location = page.getByRole('navigation', { name: 'Current location' });
  await expect(location).toContainText('From order to delivery');
  await expect(location).toContainText('Pick the order');
  await location.getByRole('button', { name: 'From order to delivery' }).click();
  await ready(page);
  expect(state(page).visiblePhases).toBeUndefined();
  await page.getByRole('button', { name: 'Show only Pick the order', exact: true }).click();
  await ready(page);
  await canvas.focus();
  await page.keyboard.press('Escape');
  await ready(page);
  expect(state(page).visiblePhases).toBeUndefined();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.studio')).toHaveClass(/presenting/);
  await page.keyboard.press('j');
  await expect(page.locator('[data-sequence-id]:focus')).toHaveCount(1);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/sequence-presentation.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio')).not.toHaveClass(/presenting/);
});

test('opening the inspector holds the diagram still rather than re-fitting it', async ({
  page
}) => {
  await page.goto(path);
  await ready(page);
  const phase = page.locator('[data-sequence-id="order"]');
  const band = phase.locator('rect').first();
  const before = (await band.boundingBox())!;
  await phase.click();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect
    .poll(async () => {
      const after = (await band.boundingBox())!;
      return [Math.round(after.x - before.x), Math.round(after.width - before.width)];
    })
    .toEqual([0, 0]);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect
    .poll(async () => {
      const after = (await band.boundingBox())!;
      return [Math.round(after.x - before.x), Math.round(after.width - before.width)];
    })
    .toEqual([0, 0]);
  // Hiding navigation uncovers canvas the panel was floating over, so holding must track the
  // screen rather than the diagram area, which never changes size.
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect
    .poll(async () => {
      const after = (await band.boundingBox())!;
      return [Math.round(after.x - before.x), Math.round(after.width - before.width)];
    })
    .toEqual([0, 0]);
  await navToggle(page).click();
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('the hold survives the zoom limit and presentation refits instead', async ({ page }) => {
  await page.goto(path);
  await ready(page);
  const canvas = page.getByRole('application');
  await canvas.focus();
  // Drive the reader to the zoom ceiling, where scale can no longer be held exactly.
  for (let i = 0; i < 30; i++) await page.keyboard.press('+');
  // Reveal the first phase before measuring. At deep zoom it starts offscreen;
  // clicking it would make browser automation scroll it into view independently.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-sequence-id="order"]')).toBeFocused();
  const band = page.locator('[data-sequence-id="order"] rect').first();
  const before = (await band.boundingBox())!;
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector')).toBeVisible();
  const after = (await band.boundingBox())!;
  // Position is held outright; scale may only move as far as the clamp forces.
  expect(Math.round(after.x - before.x)).toBe(0);
  expect(after.width / before.width).toBeGreaterThan(0.99);
  await page.getByRole('button', { name: 'Close inspector' }).click();

  // Presentation removes the studio chrome deliberately, so the diagram refits to it.
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.studio')).toHaveClass(/presenting/);
  await expect.poll(async () => (await band.boundingBox())!.width / before.width).toBeLessThan(0.6);
  const presented = (await band.boundingBox())!;
  const viewport = (await canvas.boundingBox())!;
  expect(presented.width).toBeLessThanOrEqual(viewport.width);
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio')).not.toHaveClass(/presenting/);
});

test('a sidebar perspective opens that exact saved view in the architecture studio', async ({
  page
}) => {
  await page.goto(path + '&theme=midnight');
  await ready(page);
  await page
    .getByRole('navigation', { name: 'Saved perspectives' })
    .getByRole('link')
    .nth(2)
    .click();
  await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
  // The saved perspective owns its expansion; only the reader's theme travels with them.
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'midnight');
  const control = page.locator('[data-node-id]');
  const carried = await control.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-node-id')).sort()
  );
  await page.goto('/?model=delivery&scene=trust');
  await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
  expect(
    await control.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-node-id')).sort()
    )
  ).toEqual(carried);
});

test('sequence source, jump menu and portable exports', async ({ page }) => {
  await page.goto(path);
  await ready(page);
  await page.getByRole('button', { name: /Model source/ }).click();
  await expect(page.getByRole('dialog')).toContainText('order-delivery');
  await expect(page.getByRole('dialog')).toContainText('participants');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const format of ['SVG', 'PNG']) {
    await page.getByRole('button', { name: 'Export sequence', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${format}`, exact: true }).click();
    const file = await pending;
    const data = await readFile((await file.path())!);
    if (format === 'SVG') {
      expect(data.toString()).toContain('width="1920"');
      expect(data.toString()).toContain('From order to delivery');
    } else {
      expect(data.readUInt32BE(16)).toBe(3840);
      expect(data.readUInt32BE(20)).toBe(2160);
    }
    await file.saveAs(`artifacts/sequence-browser-export.${format.toLowerCase()}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.keyboard.press('Meta+k');
  await page.getByRole('dialog').getByRole('combobox').fill('order to delivery');
  await expect(
    page.getByRole('dialog').getByRole('option').filter({ hasText: 'From order to delivery' })
  ).toContainText('Sequence');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await ready(page);
});

test('invalid journeys and views stay explicit, proposed navigation stays labelled', async ({
  page
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(path.replace('order-delivery', 'missing'));
  await expect(page.getByRole('alert')).toContainText('does not exist');
  await expect(page.locator('[data-sequence-id]')).toHaveCount(0);
  await page
    .getByRole('button', { name: /From order to delivery/ })
    .first()
    .click();
  await ready(page);
  await page.goto(path + '&seq=%7Bbroken');
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  await page.goto(
    path + '&seq=' + encodeURIComponent(JSON.stringify({ hiddenParticipants: ['missing'] }))
  );
  await expect(page.getByRole('alert')).toContainText('unknown participant');
  await page.route('**/api/models/delivery', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.sequences[0].status = 'proposed';
    await route.fulfill({ json: data });
  });
  await page.goto('/?model=delivery');
  await expect(page.getByRole('navigation', { name: 'Sequence journeys' })).toContainText(
    'Proposed'
  );
  await page.keyboard.press('Meta+k');
  await page.getByRole('dialog').getByRole('combobox').fill('order to delivery');
  await expect(
    page.getByRole('dialog').getByRole('option').filter({ hasText: 'From order to delivery' })
  ).toContainText('Proposed');
  expect(errors).toEqual([]);
});

test('sequence HTTP refuses stale and malformed projections and exports', async ({ request }) => {
  const loaded = await (await request.get('/api/models/delivery')).json();
  const body = {
    model: 'delivery',
    journey: 'order-delivery',
    revision: loaded.revision,
    state: { collapsedPhases: ['fulfillment'] }
  };
  const layout = await request.post('/api/sequence', { data: body });
  expect(layout.ok()).toBe(true);
  const svg = await request.post('/api/sequence/export', { data: body });
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  expect(await svg.text()).toContain('data-row-id="fulfillment"');
  for (const endpoint of ['/api/sequence', '/api/sequence/export']) {
    const stale = await request.post(endpoint, { data: { ...body, revision: 'old' } });
    expect(stale.status()).toBe(400);
    expect(await stale.text()).toContain('changed on disk');
    const invalid = await request.post(endpoint, {
      data: { ...body, state: { hiddenParticipants: 'customer' } }
    });
    expect(invalid.status()).toBe(400);
    const unknown = await request.post(endpoint, { data: { ...body, journey: 'missing' } });
    expect(unknown.status()).toBe(400);
  }
});

test('folding animates stable identities and rapid changes settle to the latest view', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(path);
  await ready(page);
  const before = Number(
    await page.locator('[data-sequence-id="delivery"]').getAttribute('data-current-y')
  );
  // Watch frames while the response and animation run, rather than relying on a timing sleep.
  await page.evaluate(() => {
    (window as any).__sequenceFrames = [];
    const until = performance.now() + 2500;
    const sample = () => {
      const row = document.querySelector('[data-sequence-id="delivery"]');
      if (row)
        (window as any).__sequenceFrames.push([
          Number(row.getAttribute('data-current-y')),
          Number(row.getAttribute('data-target-y'))
        ]);
      if (performance.now() < until) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Expand Prepare the parcel', exact: true }).click();
  await ready(page);
  await expect
    .poll(async () =>
      Number(await page.locator('[data-sequence-id="delivery"]').getAttribute('data-current-y'))
    )
    .not.toBe(before);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__sequenceFrames.some(
          ([current, target]: number[]) => Math.abs(current - target) > 0.5
        )
      )
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Collapse Prepare the parcel', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Prepare the parcel', exact: true }).click();
  await ready(page);
  await expect
    .poll(async () => {
      const row = page.locator('[data-sequence-id="delivery"]');
      return (
        Number(await row.getAttribute('data-current-y')) -
        Number(await row.getAttribute('data-target-y'))
      );
    })
    .toBe(0);
  expect(state(page).collapsedPhases).not.toContain('fulfillment');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Collapse Prepare the parcel', exact: true }).click();
  await ready(page);
  await expect
    .poll(async () => {
      const row = page.locator('[data-sequence-id="delivery"]');
      return (
        Number(await row.getAttribute('data-current-y')) -
        Number(await row.getAttribute('data-target-y'))
      );
    })
    .toBe(0);
});

test('sequence errors remain visible in export and reload cannot retain stale geometry', async ({
  page
}) => {
  await page.goto(path);
  await ready(page);
  await page.route('**/api/sequence/export', (route) =>
    route.fulfill({
      status: 400,
      json: { error: 'The model changed on disk. Reload the journey.' }
    })
  );
  await page.getByRole('button', { name: 'Export sequence', exact: true }).click();
  await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('changed on disk');
  await page.keyboard.press('Escape');
  await page.route('**/api/sequence', (route) =>
    route.fulfill({
      status: 400,
      json: { error: 'state.collapsedPhases references unknown phase fulfillment' }
    })
  );
  await page.getByRole('button', { name: 'Reload sequence', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unknown phase');
  await expect(page.locator('[data-sequence-id]')).toHaveCount(0);
});

test('sequence fills viewport, preserves theme and links exact participants to architecture', async ({
  page
}) => {
  await page.goto(path + '&theme=midnight');
  await ready(page);
  await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'midnight');
  const box = (await page.getByRole('application').boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(950);
  // The journey title lives in the bar now and takes the theme's text colour with it.
  await expect(page.locator('.crumb-scene')).toHaveText('From order to delivery');
  await expect(page.locator('.appbar-subtitle')).not.toBeEmpty();
  const painted = await page.locator('.theme-root').evaluate((el) => ({
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor
  }));
  expect(painted.background).not.toBe('rgb(246, 248, 244)');
  expect(painted.color).not.toBe('rgb(40, 61, 52)');
  await page.getByRole('button', { name: 'Warehouse team lane options', exact: true }).click();
  await page.getByRole('button', { name: 'Separate lanes', exact: true }).click();
  await ready(page);
  await page.locator('[data-sequence-id="shipments"] rect').click();
  const link = page.locator('.inspector').getByRole('link').first();
  await link.click();
  await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
  const view = JSON.parse(new URL(page.url()).searchParams.get('view')!);
  expect(view.scope).toBe('core.shipments');
  expect(view.theme).toBe('midnight');
});

test('long sequences can zoom to readable text and keyboard navigation reveals distant rows', async ({
  page
}) => {
  await page.route('**/api/sequence', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    // Simulate a long authored journey using valid shared row geometry spaced down the timeline.
    const row = data.rows[0];
    data.rows = Array.from({ length: 70 }, (_, i) => ({
      ...row,
      id: `long-${i}`,
      y: row.y + i * 120,
      titleY: row.titleY + i * 120,
      descriptionY: undefined,
      title: `Phase ${i}`,
      titleLines: [`Phase ${i}`]
    }));
    data.height = 8800;
    await route.fulfill({ json: data });
  });
  await page.goto(path);
  await ready(page);
  await page.getByRole('application').focus();
  for (let i = 0; i < 18; i++) await page.keyboard.press('+');
  const size = await page
    .locator('[data-sequence-id="long-0"] text')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(size).toBeGreaterThan(14);
  for (let i = 0; i < 35; i++) await page.keyboard.press('ArrowDown');
  const row = page.locator('[data-sequence-id="long-34"]');
  await expect(row).toBeFocused();
  await expect
    .poll(async () => {
      const rowBox = (await row.boundingBox())!;
      const viewport = (await page.getByRole('application').boundingBox())!;
      return rowBox.y >= viewport.y && rowBox.y + rowBox.height <= viewport.y + viewport.height;
    })
    .toBe(true);
});

test('hidden lane markers restore missing runs by pointer and keyboard without losing authored order', async ({
  page
}) => {
  const view = {
    collapsedPhases: ['order', 'dispatch', 'delivery'],
    collapsedGroups: [],
    hiddenParticipants: ['picker'],
    theme: 'midnight'
  };
  await page.goto(path + '&seq=' + encodeURIComponent(JSON.stringify(view)));
  await ready(page);
  const gap = page.locator('[data-geometry-kind="gap"]');
  await expect(gap).toHaveCount(1);
  await expect(gap).toHaveAttribute('aria-label', /Picker/);
  const marker = (await gap.boundingBox())!;
  const left = (await page.locator('[data-sequence-id="shipments"] rect').boundingBox())!;
  const right = (await page.locator('[data-sequence-id="checker"] rect').boundingBox())!;
  expect(marker.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
  expect(marker.x + marker.width).toBeLessThanOrEqual(right.x + 1);
  await page.screenshot({ path: 'artifacts/sequence-hidden-lane-marker.png' });
  await gap.click();
  await ready(page);
  await expect(gap).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Picker visibility', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-sequence-id="picker"]')).toBeVisible();
  await page.getByRole('button', { name: 'Picker visibility', exact: true }).click();
  await ready(page);
  await page.locator('[data-sequence-id="shipments"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(gap).toBeFocused();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(gap).toHaveCount(0);
  await expect(page.locator('[data-sequence-id="picker"]')).toBeVisible();
  await page.getByRole('button', { name: 'Customer visibility', exact: true }).click();
  await page.getByRole('button', { name: 'Shipment lifecycle visibility', exact: true }).click();
  await ready(page);
  await expect(gap).toHaveCount(1);
  await expect(gap).toHaveAttribute('aria-label', /2/);
  await gap.click();
  await ready(page);
  await expect(page.locator('[data-geometry-kind="column"]')).toHaveCount(6);
});

test('phase rows use compact shared geometry and grouped lanes explain their count', async ({
  page
}) => {
  await page.goto(path);
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Collapse Warehouse team', exact: true })
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: / visibility$/ })).toHaveCount(6);
  const headerHeights = await page
    .locator('[data-geometry-kind="column"] rect')
    .evaluateAll((headers) => headers.map((header) => Number(header.getAttribute('height'))));
  expect(new Set(headerHeights).size).toBe(1);
  expect(headerHeights[0]).toBe(44);
  await page.getByRole('button', { name: 'Warehouse team lane options', exact: true }).click();
  await page.getByRole('button', { name: 'Separate lanes', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('button', { name: / visibility$/ })).toHaveCount(6);
  await expect(page.locator('[data-geometry-kind="column"]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Expand all phases', exact: true }).click();
  await ready(page);
  const geometry = await page.locator('[data-geometry-kind="phase"]').evaluateAll((rows) =>
    rows.map((row) => ({
      id: row.getAttribute('data-sequence-id'),
      x: row.querySelector('rect')!.getAttribute('x'),
      height: Number(row.querySelector('rect')!.getAttribute('height')),
      textX: row.querySelector('text')!.getAttribute('x')
    }))
  );
  expect(new Set(geometry.map((row) => row.x)).size).toBe(1);
  expect(new Set(geometry.map((row) => row.textX)).size).toBe(1);
  expect(geometry.find((row) => row.id === 'order')!.height).toBe(35);
  expect(geometry.find((row) => row.id === 'fulfillment')!.height).toBe(35);
  // Every phase subtitle here fits beside its title, so no header spends a second line.
  expect(geometry.find((row) => row.id === 'picking')!.height).toBe(35);
  await expect(page.locator('[data-sequence-id="picking"] line')).toHaveCount(1);
  await expect(page.locator('[data-sequence-id="picking"] rect')).toHaveAttribute(
    'fill',
    'transparent'
  );
  await expect(page.locator('[data-sequence-id="fulfillment"] line')).toHaveCount(0);
  const selfMessage = page.locator('[data-geometry-kind="row"]:has(path)').first();
  await expect(selfMessage).toBeVisible();
  expect(
    await selfMessage.evaluate((row) => {
      const children = [...row.children];
      const rect = children.findIndex((child) => child.tagName.toLowerCase() === 'rect');
      const path = children.findIndex((child) => child.tagName.toLowerCase() === 'path');
      return rect >= 0 && path > rect && children[path].getAttribute('d')?.includes(' Q ');
    })
  ).toBe(true);
});

test('folded phases disclose hidden interactions and a grouped gap restores real columns', async ({
  page
}) => {
  const view = {
    collapsedPhases: ['order', 'fulfillment', 'dispatch', 'delivery'],
    collapsedGroups: ['warehouse'],
    hiddenParticipants: ['picker']
  };
  await page.goto(path + '&seq=' + encodeURIComponent(JSON.stringify(view)));
  await ready(page);
  const phase = page.locator('[data-sequence-id="fulfillment"]');
  await expect(phase).toContainText('2 hidden');
  await expect(phase).toHaveAttribute('data-hidden-message-ids', 'begin-picking,packed-parcel');
  const gap = page.locator('[data-geometry-kind="gap"]');
  const box = (await gap.boundingBox())!;
  const first = (await page.locator('[data-sequence-id="order"] rect').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(first.y);
  await gap.focus();
  await page.keyboard.press('Space');
  await ready(page);
  await expect(gap).toHaveCount(0);
  await expect(page.locator('[data-geometry-kind="column"]')).toHaveCount(6);
  await expect(phase).not.toContainText('hidden');
  await expect(page.locator('[data-sequence-id="picker"]')).toBeFocused();
});

test('participant disclosure stays local and lane menu Escape preserves phase focus', async ({
  page
}) => {
  await page.goto(path);
  await ready(page);
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Show only Pick the order', exact: true })
    .click();
  await ready(page);
  const url = page.url();
  await page.getByRole('button', { name: 'Collapse Warehouse team', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Picker visibility' })).toBeHidden();
  await expect(page).toHaveURL(url);
  await page.getByRole('button', { name: 'Expand Warehouse team', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Picker visibility' })).toBeVisible();
  const options = page.getByRole('button', {
    name: 'Warehouse team lane options',
    exact: true
  });
  await options.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Separate lanes', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Warehouse team lane options' })).toBeHidden();
  await expect(options).toBeFocused();
  await expect(page).toHaveURL(url);
});

test('wordmark Escape closes only its flyout and preserves sequence focus', async ({ page }) => {
  await page.goto(path);
  await ready(page);
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Show only Pick the order', exact: true })
    .click();
  await ready(page);
  const url = page.url();
  const trigger = page.getByRole('button', { name: 'About Fractal', exact: true });
  await trigger.click();
  await expect(page.getByRole('menu', { name: 'Fractal links' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Fractal links' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(url);
  expect(state(page).visiblePhases).toEqual(['picking']);
});

test('a selected phase survives a refresh and leaves the link when closed', async ({ page }) => {
  await page.goto(path);
  await ready(page);
  await page.locator('[data-sequence-id="order"]').click();
  await expect(page.locator('.inspector h2')).toHaveText('Accept the order');
  await expect(page).toHaveURL(/selected=order/);
  await page.reload();
  await ready(page);
  await expect(page.locator('.inspector h2')).toHaveText('Accept the order');
  await page.locator('.inspector-shell').getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).not.toHaveURL(/selected=/);
  await page.reload();
  await ready(page);
  await expect(page.locator('.inspector')).toHaveCount(0);
});

test('sequence inspector prioritizes interactions and progressively reveals context', async ({
  page
}) => {
  await page.goto(path);
  await ready(page);
  await page.locator('[data-sequence-id="order"]').click();
  const inspector = page.getByRole('complementary', { name: 'Selection details' });
  await expect(inspector.locator('.title-line .kind')).toHaveAttribute('aria-label', 'Phase');
  await expect(inspector.locator('.title-line .kind')).toHaveAttribute('data-kind', 'Phase');
  // The close control lives in the panel's grip now, beside the inspector's content.
  const grip = page.locator('.inspector-shell .panel-grip[data-panel-grip]');
  await expect(grip.getByRole('button', { name: 'Close inspector' })).toBeVisible();
  await expect(grip.locator('.panel-shade-label')).toHaveText('Accept the order');
  await expect(inspector.getByText('Customer → Shipment lifecycle', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Stable ID', { exact: true })).toHaveCount(3);
  const technical = inspector.locator('.secondary details').first();
  await expect(technical).not.toHaveAttribute('open');
  await technical.locator('summary').press('Enter');
  await expect(technical.getByText('order', { exact: true })).toBeVisible();
  const interaction = inspector.locator('.interactions details').first();
  await interaction.locator('summary').press('Space');
  await expect(interaction.getByText('place-order', { exact: true })).toBeVisible();
  await expect(interaction).toContainText('deliverable address');
  const context = inspector.locator('.secondary details').last();
  await expect(context).not.toHaveAttribute('open');
  await context.locator('summary').click();
  await expect(context.locator('p')).toBeVisible();
  await grip.getByRole('button', { name: 'Close inspector' }).click();
  await expect(inspector).toHaveCount(0);
});
