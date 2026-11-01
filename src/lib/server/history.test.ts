import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { noteHistory, COALESCE_MS, KEEP_VERSIONS } from './history.ts';

const fresh = () => noteHistory(new Database(':memory:'));
const texts = (h: ReturnType<typeof fresh>, path: string) =>
	h.list(path).map((v) => [v.author, h.content(path, v.id)]);

test('a write over unseen text keeps that text as an unattributed version', () => {
	const h = fresh();
	h.record('a.md', 'original', 'edited', 'agent', 1000);
	assert.deepEqual(texts(h, 'a.md'), [
		['agent', 'edited'],
		[null, 'original']
	]);
});

test('writes from different authors each get a version', () => {
	const h = fresh();
	h.record('a.md', null, 'one', 'me@x', 1000);
	h.record('a.md', 'one', 'two', 'agent', 2000);
	h.record('a.md', 'two', 'three', 'me@x', 3000);
	assert.deepEqual(texts(h, 'a.md'), [
		['me@x', 'three'],
		['agent', 'two'],
		['me@x', 'one']
	]);
});

test('rapid writes by one author fold into one version until the bucket ends', () => {
	const h = fresh();
	h.record('a.md', null, 'start', 'me@x', 0);
	let cur = 'x';
	h.record('a.md', 'start', cur, 'agent', 1000);
	for (let i = 1; i < 20; i++) h.record('a.md', cur, (cur += 'x'), 'agent', 1000 + i * 1000);
	assert.deepEqual(texts(h, 'a.md'), [
		['agent', 'x'.repeat(20)],
		['me@x', 'start']
	]);
	const [top] = h.list('a.md');
	assert.equal(top.created_at, 1000);
	assert.equal(top.at, 20000);
	h.record('a.md', cur, 'later', 'agent', 1000 + COALESCE_MS);
	assert.equal(h.list('a.md').length, 3);
});

test('an unchanged write books nothing', () => {
	const h = fresh();
	h.record('a.md', null, 'same', 'me@x', 0);
	h.record('a.md', 'same', 'same', 'agent', 1000);
	assert.deepEqual(texts(h, 'a.md'), [['me@x', 'same']]);
});

test('a restore never folds into the last version', () => {
	const h = fresh();
	h.record('a.md', null, 'v1', 'me@x', 0);
	h.record('a.md', 'v1', 'v2', 'agent', 1000);
	h.record('a.md', 'v2', 'v2 typed', 'me@x', 2000);
	h.record('a.md', 'v2 typed', 'v1', 'me@x', 3000, false);
	assert.deepEqual(texts(h, 'a.md'), [
		['me@x', 'v1'],
		['me@x', 'v2 typed'],
		['agent', 'v2'],
		['me@x', 'v1']
	]);
});

test('only the newest versions are kept, per note', () => {
	const h = fresh();
	h.record('b.md', null, 'other', 'me@x', 0);
	let cur: string | null = null;
	for (let i = 0; i < KEEP_VERSIONS + 10; i++) {
		const next = `v${i}`;
		h.record('a.md', cur, next, i % 2 ? 'me@x' : 'agent', i);
		cur = next;
	}
	const list = h.list('a.md');
	assert.equal(list.length, KEEP_VERSIONS);
	assert.equal(h.content('a.md', list[0].id), `v${KEEP_VERSIONS + 9}`);
	assert.equal(h.content('a.md', list.at(-1)!.id), 'v10');
	assert.equal(h.list('b.md').length, 1);
});

test('history follows a folder rename and drops with its path', () => {
	const h = fresh();
	h.record('dir/a.md', null, 'a', 'me@x', 0);
	h.record('dir2/b.md', null, 'b', 'me@x', 0);
	h.rename('dir', '.trash/1-dir');
	assert.equal(h.list('dir/a.md').length, 0);
	assert.equal(h.list('.trash/1-dir/a.md').length, 1);
	assert.equal(h.list('dir2/b.md').length, 1);
	h.drop('.trash/1-dir');
	assert.equal(h.list('.trash/1-dir/a.md').length, 0);
});
