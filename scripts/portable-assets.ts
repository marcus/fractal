import { readFile } from 'node:fs/promises';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/** Bundle the same canvas and application core into one offline reader. Build once per process. */
export async function buildPortableAssets() {
  const root = process.cwd();
  const result = await build({
    root,
    configFile: false,
    logLevel: 'error',
    plugins: [svelte({ configFile: false, compilerOptions: { runes: true } })],
    resolve: { alias: { $lib: `${root}/src/lib` } },
    build: {
      write: false,
      sourcemap: false,
      minify: true,
      cssCodeSplit: false,
      assetsInlineLimit: Infinity,
      lib: { entry: `${root}/src/lib/portable/main.ts`, name: 'FractalReader', formats: ['iife'] }
    }
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    'output' in output ? output.output : []
  );
  const scripts = outputs.filter((entry) => entry.type === 'chunk');
  const css = outputs.filter((entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'));
  if (scripts.length !== 1 || outputs.length !== scripts.length + css.length)
    throw new Error('Portable viewer build produced external assets');
  const notices = await Promise.all(
    [
      ['Fractal (Apache 2.0)', 'LICENSE'],
      ['Fractal notice', 'NOTICE'],
      ['Svelte (MIT)', 'node_modules/svelte/LICENSE.md'],
      ['Roc icons (MIT)', 'node_modules/@marcusv/roc/LICENSE'],
      ['Inter (OFL 1.1)', 'node_modules/@fontsource-variable/inter/LICENSE'],
      [
        'elkjs (EPL 2.0), unmodified. Source: https://github.com/kieler/elkjs',
        'node_modules/elkjs/LICENSE.md'
      ]
    ].map(async ([name, path]) => `${name}\n\n${await readFile(`${root}/${path}`, 'utf8')}`)
  );
  return {
    notices: notices.join('\n\n--------------------\n\n'),
    js: scripts[0].code,
    css: css.map((entry) => (entry.type === 'asset' ? entry.source : '')).join('\n')
  };
}
