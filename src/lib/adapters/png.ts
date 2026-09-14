/** Headless counterpart of browser SVG rasterization. Chromium is a CLI export dependency only. */

/**
 * The `width`/`height` the SVG root declares, when it declares both as plain numbers.
 * Composed artwork always does (`exportCompositionSvg` sizes the root to the artwork);
 * unparseable roots keep the default viewport instead of failing the export.
 */
function svgSize(svg: string): { width: number; height: number } | undefined {
  const opening = svg.slice(0, svg.indexOf('>') + 1);
  const width = /width="([\d.]+)"/.exec(opening)?.[1];
  const height = /height="([\d.]+)"/.exec(opening)?.[1];
  if (width === undefined || height === undefined) return undefined;
  const parsed = { width: Number(width), height: Number(height) };
  if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return undefined;
  if (parsed.width <= 0 || parsed.height <= 0) return undefined;
  return parsed;
}

export async function renderPng(
  svg: string,
  options: { fullPage?: boolean } = {}
): Promise<Buffer> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    // Composed artwork must fill the PNG at its own aspect: a full-page capture of a
    // page smaller than the viewport is still viewport-sized (letterboxed), so the
    // viewport is sized to the declared artwork first. The default viewport
    // screenshot for single-model export is unchanged.
    const size = options.fullPage === true ? svgSize(svg) : undefined;
    const page = await browser.newPage({
      viewport:
        size === undefined
          ? { width: 1920, height: 1080 }
          : { width: Math.ceil(size.width), height: Math.ceil(size.height) },
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
