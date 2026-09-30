import assert from 'node:assert/strict';
import test from 'node:test';
import { breakSegments, fitTitleSize, textWidth, wrapText } from '../src/lib/core/projection';
import { measure } from '../src/lib/core/measure';
import type { Element, Projection } from '../src/lib/core/types';

const element = (title: string): Element => ({
  id: 'a',
  sourceId: 'a',
  parent: null,
  title,
  kind: 'service',
  description: '',
  technology: '',
  status: 'current',
  color: '#548573',
  evidence: []
});
const projection = (title: string): Projection => ({
  elements: [element(title)],
  edges: [],
  expanded: [],
  hiddenCount: 0
});

test('identifiers break at separators and camelCase boundaries, not inside words', () => {
  assert.deepEqual(breakSegments('request_more_tools'), ['request_', 'more_', 'tools']);
  assert.deepEqual(breakSegments('a.b/c-d'), ['a.', 'b/', 'c-', 'd']);
  assert.deepEqual(breakSegments('requestMoreTools'), ['request', 'More', 'Tools']);
  assert.deepEqual(breakSegments('HTTPServer'), ['HTTP', 'Server']);
  assert.deepEqual(breakSegments('plain'), ['plain']);
});

test('a long identifier wraps at its break points before splitting a word', () => {
  const lines = wrapText('request_more_tools_for_the_agent', 128, 14);
  assert.equal(lines.join(''), 'request_more_tools_for_the_agent');
  assert.ok(lines.every((line) => textWidth(line, 14) <= 128));
  assert.ok(lines.every((line) => line.endsWith('_') || line === lines[lines.length - 1]));
});

test('an identifier that fits one line when the card widens is not broken at all', () => {
  const [node] = measure(projection('request_more_tools')).nodes;
  assert.deepEqual(node.titleLines, ['request_more_tools']);
  assert.equal(node.titleSize, undefined);
});

test('a single unbreakable piece shrinks before it splits, and only then splits', () => {
  assert.equal(fitTitleSize('short', 172, 14), 14);
  const wide = 'abcdefghijklmnopqrstuvwxyz';
  assert.ok(fitTitleSize(wide, textWidth(wide, 13) + 1, 14) === 13);
  const [node] = measure(projection('abcdefghijklmnopqrstuvwxyzabcdefghijklm')).nodes;
  assert.equal(node.titleSize, 12);
  assert.equal(node.titleLines.join(''), 'abcdefghijklmnopqrstuvwxyzabcdefghijklm');
});
