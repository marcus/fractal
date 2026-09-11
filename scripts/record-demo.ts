import { chromium } from '@playwright/test';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('artifacts');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: resolve(output, 'recordings'), size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5199/');
  await page.waitForSelector('[data-node-id]');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.mouse.move(1900, 20);
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(3300);
  }
  const video = page.video()!;
  await context.close();
  await copyFile(await video.path(), resolve(output, 'delivery-walkthrough.webm'));
  console.log(JSON.stringify({ video: resolve(output, 'delivery-walkthrough.webm') }));
} finally {
  await browser.close();
}
