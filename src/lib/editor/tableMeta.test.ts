import assert from 'node:assert/strict';
import test from 'node:test';
import { localDay, parseMeta, tableView } from './tableMeta.ts';

const rows = [
	['Boston, MA', localDay(-3)],
	['Remote', localDay(2)],
	['Seattle, WA', localDay(60)]
];
const view = (filter: string) =>
	tableView(rows, parseMeta(`<!-- scrinium-table: {"v":1,"filter":${filter}} -->`), []);

test('a row stays when it matches any of a column\'s filters', () => {
	assert.deepEqual(view('{"0":{"text":["remote","boston"]}}'), [0, 1]);
	assert.deepEqual(view('{"1":{"date":["overdue","week"]}}'), [0, 1]);
	assert.deepEqual(view('{"0":{"text":["remote","boston"]},"1":{"date":["overdue"]}}'), [0]);
});

test('a lone string filter still reads', () => {
	assert.deepEqual(view('{"0":{"text":"remote"}}'), [1]);
	assert.deepEqual(view('{"1":{"date":"overdue"}}'), [0]);
});
