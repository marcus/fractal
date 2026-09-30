/** Headless counterpart of browser SVG rasterization. Chromium is a CLI export dependency only. */
import { access } from 'node:fs/promises';

/** The install command that fetches the exact browser this Playwright revision launches. */
export const CHROMIUM_INSTALL_COMMAND = 'npx playwright install chromium-headless-shell';

/** Environment variable naming an existing Chrome or Chromium executable to use instead. */
export const CHROMIUM_PATH_ENV = 'FRACTAL_CHROMIUM_PATH';

const ALTERNATIVE =
  `set ${CHROMIUM_PATH_ENV} (or pass --chromium PATH on the CLI) to an existing Chrome or Chromium, ` +
  'or export SVG and rasterize it: rsvg-convert -w 3840 scene.svg -o scene.png';

/**
 * PNG export cannot start because there is no usable browser. The CLI prints `toJSON()` and the
 * HTTP route answers 503 with it, so both surfaces give the same short, structured answer instead
 * of Playwright's multi-line banner.
 */
export class PngExportError extends Error {
  constructor(
    readonly code: 'png-export-needs-chromium' | 'png-export-chromium-not-found',
    readonly fix: string,
    readonly detail: { path?: string; alternative?: string } = {}
  ) {
    super(code);
    this.name = 'PngExportError';
  }

  toJSON(): { error: string; fix: string; path?: string; alternative?: string } {
    return {
      error: this.code,
      fix: this.fix,
      ...(this.detail.path === undefined ? {} : { path: this.detail.path }),
      ...(this.detail.alternative === undefined ? {} : { alternative: this.detail.alternative })
    };
  }
}

export interface PngOptions {
  /** Capture the whole page at the artwork's own size (composed exports). */
  fullPage?: boolean;
  /** An existing Chrome or Chromium executable; defaults to `FRACTAL_CHROMIUM_PATH`, then Playwright's. */
  chromiumPath?: string;
  env?: NodeJS.ProcessEnv;
}

/** Playwright reports a missing browser as one multi-line message; that is the only case we translate. */
function isMissingBrowser(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|npx playwright install/.test(message);
}

/**
 * Launch Chromium once, or fail with a `PngExportError`. An explicit executable that does not
 * exist is reported with its path before Playwright is involved.
 */
async function launchChromium(options: PngOptions) {
  const { chromium } = await import('@playwright/test');
  const configured = options.chromiumPath || (options.env ?? process.env)[CHROMIUM_PATH_ENV];
  if (configured) {
    try {
      await access(configured);
    } catch {
      throw new PngExportError(
        'png-export-chromium-not-found',
        `Point ${CHROMIUM_PATH_ENV} (or --chromium) at an existing Chrome or Chromium executable, or unset it`,
        { path: configured, alternative: ALTERNATIVE }
      );
    }
    return chromium.launch({ executablePath: configured });
  }
  try {
    return await chromium.launch();
  } catch (error) {
    if (isMissingBrowser(error))
      throw new PngExportError('png-export-needs-chromium', CHROMIUM_INSTALL_COMMAND, {
        alternative: ALTERNATIVE
      });
    throw error;
  }
}

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

export async function renderPng(svg: string, options: PngOptions = {}): Promise<Buffer> {
  const browser = await launchChromium(options);
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
