/** Headless counterpart of browser SVG rasterization. Chromium is a CLI export dependency only. */
export async function renderPng(
  svg: string,
  options: { fullPage?: boolean } = {}
): Promise<Buffer> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2
    });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    // Composed artwork is wider than one viewport and must include offscreen content, so
    // composition export captures the full page; the default viewport screenshot is
    // unchanged for single-model export.
    return await page.screenshot({
      type: 'png',
      ...(options.fullPage === true ? { fullPage: true } : {})
    });
  } finally {
    await browser.close();
  }
}
