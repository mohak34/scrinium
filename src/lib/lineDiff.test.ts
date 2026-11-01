import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff } from './lineDiff.ts';

const show = (a: string, b: string, max?: number) =>
	lineDiff(a, b, max).map((l) => `${{ same: ' ', add: '+', del: '-' }[l.kind]}${l.text}`);

test('marks removed and added lines around unchanged ones', () => {
	assert.deepEqual(show('a\nb\nc\nd', 'a\nc\nx\nd'), [' a', '-b', ' c', '+x', ' d']);
});

test('a replaced block lists the removed lines first', () => {
	assert.deepEqual(show('h\n1\n2\nt', 'h\n3\n4\nt'), [' h', '-1', '-2', '+3', '+4', ' t']);
});

test('identical text has no changes', () => {
	assert.deepEqual(show('a\nb', 'a\nb'), [' a', ' b']);
});

test('a middle past the table limit shows as one block each way', () => {
	assert.deepEqual(show('h\n1\n2\nt', 'h\n2\n3\nt', 1), [' h', '-1', '-2', '+2', '+3', ' t']);
});
