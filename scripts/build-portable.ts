import { mkdir, writeFile } from 'node:fs/promises';
import { buildPortableAssets } from './portable-assets';

await mkdir('build', { recursive: true });
await writeFile('build/portable.json', JSON.stringify(await buildPortableAssets()));
