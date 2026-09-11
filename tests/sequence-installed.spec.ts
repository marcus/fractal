import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

/** The theme is a fly-out on the floating bar now, not a select. */
async function chooseTheme(page: Page, name: 'Grove' | 'Graphite' | 'Midnight') {
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
}

// Operational proof against the installed build and a repository-owned Fictional Delivery Service journey.
// FRACTAL_PROOF_SEQUENCE_SOURCE names that repository's sequences.json; the proof is skipped
// without it. Exact source bytes are restored even if the reload assertion fails.
const sourcePath = process.env.FRACTAL_PROOF_SEQUENCE_SOURCE;
test('installed sequence reads repository edits, refuses stale exports, and presents shared geometry', async ({
  page
}) => {
  test.skip(
    !sourcePath,
    'Set FRACTAL_PROOF_SEQUENCE_SOURCE to the installed Fictional Delivery Service sequences.json'
  );
  if (!sourcePath) return;
  test.setTimeout(45000);
  const original = await readFile(sourcePath, 'utf8');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/sequence?model=delivery&journey=order-delivery');
  await expect(page.locator('[data-sequence-id="fulfillment"]')).toBeVisible();
  await expect(page.getByText('Updating sequence', { exact: true })).toHaveCount(0);
  const before = await (await page.request.get('/api/models/delivery')).json();
  const changed = JSON.parse(original);
  changed.journeys[0].description = 'Repository-owned sequence reload verified';
  try {
    await writeFile(sourcePath, JSON.stringify(changed, null, 2) + '\n');
    const stale = await page.request.post('/api/sequence/export', {
      data: { model: 'delivery', journey: 'order-delivery', revision: before.revision }
    });
    expect(stale.status()).toBe(400);
    await page.getByRole('button', { name: 'Reload sequence', exact: true }).click();
    // The journey's description is the bar's subtitle now, not a heading on the canvas.
    await expect(page.locator('.appbar-subtitle')).toContainText(
      'Repository-owned sequence reload verified'
    );
    await expect(page.getByText('Updating sequence', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await writeFile(sourcePath, original);
  }
  await page.getByRole('button', { name: 'Reload sequence', exact: true }).click();
  await expect(page.getByText('Updating sequence', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Prepare the parcel', exact: true }).click();
  await expect(page.locator('[data-sequence-id="summary:packed-parcel"]')).toBeVisible();
  await chooseTheme(page, 'Midnight');
  await expect(page.getByText('Updating sequence', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.screenshot({ path: 'artifacts/installed-sequence-presentation.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export sequence', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const file = await pending;
  await file.saveAs('artifacts/installed-sequence.png');
  const data = await readFile((await file.path())!);
  expect(data.readUInt32BE(16)).toBe(3840);
  expect(data.readUInt32BE(20)).toBe(2160);
  expect(errors).toEqual([]);
});

test('installed hidden lane control restores the repository-owned participant', async ({
  page
}) => {
  const seq = {
    collapsedPhases: ['order', 'fulfillment', 'dispatch', 'delivery'],
    collapsedGroups: [],
    hiddenParticipants: ['picker'],
    theme: 'midnight'
  };
  await page.goto(
    '/sequence?model=delivery&journey=order-delivery&seq=' + encodeURIComponent(JSON.stringify(seq))
  );
  const gap = page.getByRole('button', {
    name: 'Reveal 1 hidden lane: Picker',
    exact: true
  });
  await expect(gap).toBeVisible();
  await expect(page.locator('[data-sequence-id="fulfillment"]')).toContainText('2 hidden');
  await page.screenshot({ path: 'artifacts/installed-hidden-lane-marker.png' });
  await gap.click();
  await expect(page.locator('[data-sequence-id="picker"]')).toBeVisible();
  await expect(gap).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Picker visibility', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
});
