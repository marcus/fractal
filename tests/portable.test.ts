import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { buildPortableAssets } from '../scripts/portable-assets';
import { exportHtml } from '../src/lib/adapters/html';
import { loadDirectory } from '../src/lib/server/models';
import { scriptJson } from '../src/lib/portable/document';

test('script data preserves authored closing tags and Unicode without executable markup', () => {
  const value = { text: '</ScRiPt><script>alert(1)</script>&<>\u2028\u2029' };
  assert(!scriptJson(value).includes('<'));
  assert.deepEqual(JSON.parse(scriptJson(value)), value);
});

test(
  'portable document explores the shared model offline and from a nested HTTP path',
  { timeout: 60000 },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), 'fractal-portable-'));
    const { model, sequences } = await loadDirectory(resolve('examples/delivery'));
    const hostile = '</script><script>globalThis.fractalInjection=true</script>';
    model.provenance += hostile;
    model.elements.find((element) => element.id === 'core')!.evidence = ['src/core.ts:42', hostile];
    const html = await exportHtml(model, {
      state: model.scenes[0],
      scene: 'overview',
      sequences,
      assets: await buildPortableAssets()
    });
    assert(!html.includes(process.cwd()), 'export must not leak the source checkout');
    assert(!html.includes('sourceMappingURL'), 'export must not expose source maps');
    const file = join(temp, 'diagram.html');
    await writeFile(file, html);
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce'
      });
      const page = await context.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => requests.push(request.url()));
      await context.setOffline(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('[data-node-id="core"]')).toBeVisible();
      await page.getByRole('button', { name: 'Expand Delivery Operations', exact: true }).click();
      await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
      await page.locator('[data-node-id="core"]').click({ position: { x: 30, y: 22 } });
      await expect(page.locator('.inspector-shell')).toBeVisible();
      await page
        .locator('.inspector-shell')
        .getByText('Sources & context', { exact: true })
        .click();
      await expect(page.locator('.evidence').first()).toHaveText('src/core.ts:42');
      assert.equal(
        await page.evaluate(
          () => (globalThis as typeof globalThis & { fractalInjection?: boolean }).fractalInjection
        ),
        undefined
      );
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /^Midnight/ }).click();
      await expect(page.locator('.studio')).toHaveAttribute('data-theme', 'midnight');
      await page.waitForFunction(() => location.hash.includes('midnight'));
      const viewUrl = page.url();
      await page.reload();
      await expect(page.locator('.studio')).toHaveAttribute('data-theme', 'midnight');
      await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
      await page.getByRole('button', { name: 'Explore', exact: true }).click();
      await page.getByRole('button', { name: 'From order to delivery', exact: true }).click();
      await expect(
        page.getByRole('application', { name: 'Interactive sequence diagram' })
      ).toBeVisible();
      await expect(
        page.getByText('Fictional scenario authored for Fractal.', { exact: false })
      ).toHaveCount(0);
      await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      assert(
        requests.every((url) => url.startsWith('file:')),
        `unexpected offline requests: ${requests.join(', ')}`
      );
      await context.setOffline(false);
      requests.length = 0;
      const nested = `http://127.0.0.1:${port}/shared/random-uuid/document/`;
      await page.goto(nested + new URL(viewUrl).hash);
      await expect(page.locator('[data-node-id="core.shipments"]')).toBeVisible();
      await page.getByRole('button', { name: 'Collapse component', exact: false }).click();
      await expect(page.locator('[data-node-id="core.shipments"]')).toHaveCount(0);
      await page.waitForFunction(() => !document.body.innerText.includes('Arranging view…'));
      assert(
        requests.every((url) => url === nested),
        `unexpected external requests: ${requests.join(', ')}`
      );
      // Scene-only links restore authored state both on a fresh open and same-page navigation.
      await page.goto('about:blank');
      await page.goto(nested + '#scene=execution');
      await expect(page.locator('[data-node-id="core.floor.picker"]')).toBeVisible();
      await page.waitForFunction(() => {
        const hash = new URLSearchParams(location.hash.slice(1));
        return JSON.parse(hash.get('view') ?? '{}').scope === 'core';
      });
      await page.evaluate(() => {
        location.hash = 'scene=overview';
      });
      await expect(page.locator('[data-node-id="intake"]')).toBeVisible();
      await expect(page.locator('[data-node-id="core.floor.picker"]')).toHaveCount(0);
      await page.waitForFunction(() => {
        const hash = new URLSearchParams(location.hash.slice(1));
        const view = JSON.parse(hash.get('view') ?? '{}');
        return hash.get('scene') === 'overview' && view.expanded?.length === 0 && !view.scope;
      });
      const custom = { expanded: [], lens: 'trust', proposed: true, theme: 'graphite' };
      await page.goto(
        nested + '#' + new URLSearchParams({ scene: 'execution', view: JSON.stringify(custom) })
      );
      await expect(page.locator('[data-node-id="intake"]')).toBeVisible();
      await expect(page.locator('.studio')).toHaveAttribute('data-theme', 'graphite');
      assert.deepEqual(
        JSON.parse(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('view')!),
        custom
      );
      assert.deepEqual(errors, []);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Theme', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.getByRole('button', { name: 'Explore', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Explore document' })).toBeVisible();
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(temp, { recursive: true, force: true });
    }
  }
);
