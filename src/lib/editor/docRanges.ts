/**
 * Per-document memo and sorted-range lookups shared by the editor scans
 * (math, tables, callouts, live preview, folding).
 *
 * `perDoc` caches a scan per document and syntax tree: every plugin that
 * asks for the same facts in one update gets the same array, and a
 * keystroke recomputes each scan once instead of once per caller. The tree
 * is part of the key because the background parser replaces it as it
 * catches up, and a tree-based scan must see the new one.
 *
 * The lookups take ranges sorted by `from` that never overlap, so `to`
 * is sorted too and each check is a binary search, not a scan.
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import { parseFrontmatter } from './frontmatter';

export interface Span {
	from: number;
	to: number;
}

export function perDoc<T>(compute: (state: EditorState) => T): (state: EditorState) => T {
	const cache = new WeakMap<Text, { tree: ReturnType<typeof syntaxTree>; value: T }>();
	return (state) => {
		const tree = syntaxTree(state);
		const hit = cache.get(state.doc);
		if (hit && hit.tree === tree) return hit.value;
		const value = compute(state);
		cache.set(state.doc, { tree, value });
		return value;
	};
}

// Index of the first range whose `to` passes pos (>= when closed).
function firstEnding(ranges: readonly Span[], pos: number, closed: boolean): number {
	let lo = 0;
	let hi = ranges.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const to = ranges[mid].to;
		if (closed ? to >= pos : to > pos) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}

/** pos inside [from, to). */
export function inSpan(ranges: readonly Span[], pos: number): boolean {
	const r = ranges[firstEnding(ranges, pos, false)];
	return r !== undefined && r.from <= pos;
}

/** pos inside [from, to]. */
export function inSpanClosed(ranges: readonly Span[], pos: number): boolean {
	const r = ranges[firstEnding(ranges, pos, true)];
	return r !== undefined && r.from <= pos;
}

/** [from, to] meets some range, touching ends included. */
export function touchesSpan(ranges: readonly Span[], from: number, to: number): boolean {
	const r = ranges[firstEnding(ranges, from, true)];
	return r !== undefined && r.from <= to;
}

/** [from, to] lies inside one range, ends included. */
export function withinSpan(ranges: readonly Span[], from: number, to: number): boolean {
	const r = ranges[firstEnding(ranges, from, true)];
	return r !== undefined && r.from <= from && to <= r.to;
}

/** Some range lies strictly inside (from, to). */
export function spanInside(ranges: readonly Span[], from: number, to: number): boolean {
	let lo = 0;
	let hi = ranges.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (ranges[mid].from > from) hi = mid;
		else lo = mid + 1;
	}
	const r = ranges[lo];
	return r !== undefined && r.to < to;
}

/** Offset past the frontmatter block, 0 without one. */
export const fmEnd = perDoc((state) =>
	/^---\s*$/.test(state.doc.line(1).text) ? (parseFrontmatter(state.doc.toString())?.bodyStart ?? 0) : 0
);

/** Fenced, indented and inline code, in doc order. */
export const codeRanges = perDoc((state) => {
	const out: Span[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') {
				out.push({ from: node.from, to: node.to });
				return false;
			}
		}
	});
	return out;
});
