/** Headless counterpart of browser SVG rasterization. Chromium is a CLI export dependency only. */
export async function renderPng(svg: string): Promise<Buffer> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2
    });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}
