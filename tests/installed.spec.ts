import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Opt-in operational proof against an already installed studio and its real catalog.
// Only Fractal's own companion is temporarily edited; exact bytes are restored in finally.
async function ready(page: Page) {
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  await expect(page.locator('.diagram-area')).toHaveAttribute('aria-busy', 'false');
}
/** The theme is a fly-out on the floating bar now, not a select. */
async function chooseTheme(page: Page, name: 'Grove' | 'Graphite' | 'Midnight') {
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
}

test('installed studio switches repositories, reloads live sources and exports', async ({
  page
}) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?model=delivery&scene=overview');
  await ready(page);
  await page
    .getByRole('button', { name: 'Switch project: Fictional Delivery Service', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Search projects', exact: true }).fill('Fractal');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.getByRole('application')).toHaveAttribute(
    'aria-label',
    'Fractal interactive architecture'
  );
  await chooseTheme(page, 'Midnight');
  await page.getByRole('button', { name: '02 From meaning to geometry', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.screenshot({ path: 'artifacts/installed-fractal-presentation.png' });
  await page.keyboard.press('Escape');
  const companionPath = resolve(
    process.env.FRACTAL_PROOF_COMPANION_SOURCE ?? 'docs/diagrams/fractal/fractal.json'
  );
  const original = await readFile(companionPath, 'utf8');
  const companion = JSON.parse(original);
  const marker = 'Live repository reload verified';
  const before = await (await page.request.get('/api/models/fractal')).json();
  try {
    companion.description = marker;
    await writeFile(companionPath, JSON.stringify(companion, null, 2) + '\n');
    await page.getByRole('button', { name: 'Model source' }).click();
    await page.getByRole('button', { name: 'Reload model', exact: true }).click();
    await ready(page);
    const after = await (await page.request.get('/api/models/fractal')).json();
    expect(after.model.description).toBe(marker);
    expect(after.revision).not.toBe(before.revision);
    await page.getByRole('button', { name: 'Switch project: Fractal', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(marker);
    await page.keyboard.press('Escape');
  } finally {
    await writeFile(companionPath, original);
  }
  await page.reload();
  await ready(page);
  for (const format of ['Vector SVG', 'High-resolution PNG']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.locator('.export-preview img')).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(format) }).click();
    const file = await pending;
    const data = await readFile((await file.path())!);
    if (format === 'Vector SVG') {
      expect(data.toString()).toContain('width="1920"');
      await file.saveAs('artifacts/installed-fractal.svg');
    } else {
      expect(data.readUInt32BE(16)).toBe(3840);
      expect(data.readUInt32BE(20)).toBe(2160);
      await file.saveAs('artifacts/installed-fractal.png');
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.keyboard.press('Meta+k');
  await page
    .getByRole('combobox', {
      name: 'Search projects, components, connections, views and sequences'
    })
    .fill('Fictional Delivery Service');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page).toHaveURL(/model=delivery/);
  expect(errors).toEqual([]);
});
