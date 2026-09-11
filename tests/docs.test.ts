import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI_REFERENCE_PATH,
  captureHelp,
  listCommands,
  renderCliReference,
  writeCliReference
} from '../scripts/docs';

const parentHelp = [
  'Tool',
  '',
  'Commands:',
  '  one    First',
  '  two    Second',
  '',
  'Options:'
].join('\n');
const childHelp = ['Tool two', '', 'Commands:', '  deep   Nested', '', 'Options:'].join('\n');

function fakeRunner(argv: string[]): string {
  return argv[0] === 'two' ? childHelp : parentHelp;
}

test('help capture lists commands in order and folds subcommands that repeat the parent text', () => {
  assert.deepEqual(listCommands(parentHelp), ['one', 'two']);
  assert.deepEqual(listCommands('No command block'), []);
  const group = captureHelp([], fakeRunner);
  assert.deepEqual(group.shared, ['one']);
  assert.equal(group.groups.length, 1);
  assert.deepEqual(group.groups[0].argv, ['two']);
  assert.deepEqual(group.groups[0].shared, ['deep']);
  const markdown = renderCliReference(group);
  assert.match(markdown, /^## fractal$/m);
  assert.match(markdown, /^## fractal two$/m);
  assert.match(markdown, /`one` print this same text/);
});

test('committed CLI reference matches the current --help output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fractal-docs-'));
  try {
    const generated = join(dir, 'cli.md');
    await writeCliReference(generated);
    const [fresh, committed] = await Promise.all([
      readFile(generated, 'utf8'),
      readFile(CLI_REFERENCE_PATH, 'utf8')
    ]);
    assert.equal(
      committed,
      fresh,
      'docs/guides/active/cli.md is stale. Run `npm run docs` and commit the result.'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
