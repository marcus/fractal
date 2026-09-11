import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: process.env.FRACTAL_INSTALLED_PROOF
    ? ['installed.spec.ts', 'sequence-installed.spec.ts']
    : ['browser.spec.ts', 'sequence-browser.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  outputDir: 'artifacts/browser-results',
  use: {
    baseURL: process.env.FRACTAL_TEST_URL ?? 'http://127.0.0.1:5299',
    viewport: { width: 1512, height: 982 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure'
  },
  webServer: process.env.FRACTAL_TEST_URL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 5299 --strictPort',
        url: 'http://127.0.0.1:5299',
        reuseExistingServer: !process.env.CI,
        env: { FRACTAL_CATALOG: '', FRACTAL_MODELS_DIR: resolve('examples') }
      }
});
