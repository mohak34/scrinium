/**
 * Shared GFM table range finder (parser only, no view imports).
 *
 * Only top-level tables count: a table inside a quote, callout or list
 * would need its `>` / indent prefixes kept, so those stay plain text.
 * Ranges cover whole lines, the settings comment above a table included
 * (tableMeta.ts). Tables in frontmatter or overlapping display
 * math are skipped so two block replaces never claim the same lines.
 *
 * Used by tableBlock.ts (the rendered widget) and livePreview.ts (inline
 * math, wikilinks and tags never decorate inside a table, so no inline
 * replace overlaps the table's block replace).
 *
 * Also the table model the cell editor and table commands work on:
 * `rowCells` (each cell's trimmed source range), `readTable` and
 * `writeTable` (parse to rows + alignments, write back as clean GFM).
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';
import { fmEnd, perDoc, touchesSpan } from './docRanges';
import { findMathBlockRanges, inlineMathRegex } from './mathRanges';
import { findWikilinksInText } from './wikilinks';
import { parseMeta, type TableMeta } from './tableMeta';

export interface TableRange {
	// The settings line when there is one, else the header line.
	from: number;
	to: number;
	// Start of the header line.
	start: number;
	// The table's markdown, header to last row (no settings line).
	source: string;
	meta: TableMeta | null;
}

/** Top-level tables in doc order, cached per document. */
export const findTableRanges = perDoc((state: EditorState): readonly TableRange[] => {
	const fm = fmEnd(state);
	const math = findMathBlockRanges(state);
	const out: TableRange[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== 'Table') return;
			if (node.node.parent?.name === 'Document') {
				const head = state.doc.lineAt(node.from);
				const to = state.doc.lineAt(node.to).to;
				if (head.from >= fm && !touchesSpan(math, head.from, to)) {
					const above = head.number > 1 ? state.doc.line(head.number - 1) : null;
					const meta = above && above.from >= fm ? parseMeta(above.text) : null;
					out.push({
						from: meta ? above!.from : head.from,
						to,
						start: head.from,
						source: state.doc.sliceString(head.from, to),
						meta
					});
				}
			}
			return false;
		}
	});
	return out;
});

type Span = { from: number; to: number };

/**
 * Spans in a source row whose pipes don't split cells: the renderer swaps
 * inline code, inline math and wikilinks out before markdown-it sees the
 * row, in that order, each pass over the text the last one left. Masking
 * each span before the next pass repeats that. Offsets are relative to the
 * row.
 */
function protectedSpans(state: EditorState, from: number, text: string): Span[] {
	const spans: Span[] = [];
	let masked = text;
	const mask = (found: Span[]) => {
		for (const s of found) {
			spans.push(s);
			masked = masked.slice(0, s.from) + 'x'.repeat(s.to - s.from) + masked.slice(s.to);
		}
	};
	const code: Span[] = [];
	syntaxTree(state).iterate({
		from,
		to: from + text.length,
		enter: (n) => {
			if (n.name === 'InlineCode') code.push({ from: n.from - from, to: n.to - from });
		}
	});
	mask(code);
	mask(
		Array.from(masked.matchAll(inlineMathRegex()), (m) => ({
			from: m.index,
			to: m.index + m[0].length
		}))
	);
	// The renderer skips wikilinks overlapping a stashed span.
	mask(
		findWikilinksInText(masked).filter((w) => !spans.some((s) => w.from < s.to && s.from < w.to))
	);
	return spans;
}

/**
 * Content of each cell in a table row, as absolute doc ranges with the
 * padding spaces trimmed. An empty cell is a point, one space in when the
 * cell has room, so typing into it gives `| x |`.
 */
export function rowCells(state: EditorState, line: Line): Span[] {
	const text = line.text;
	const spans = protectedSpans(state, line.from, text);
	const splits = (i: number) =>
		text[i] === '|' && text[i - 1] !== '\\' && !spans.some((s) => i >= s.from && i < s.to);
	let start = text.length - text.trimStart().length;
	if (text[start] === '|') start++;
	let end = text.trimEnd().length;
	if (end > start && splits(end - 1)) end--;
	const cells: Span[] = [];
	let seg = start;
	for (let i = start; i <= end; i++) {
		if (i < end && !splits(i)) continue;
		const body = text.slice(seg, i);
		const lead = body.length - body.trimStart().length;
		const pos = body.trim()
			? { from: seg + lead, to: i - (body.length - body.trimEnd().length) }
			: { from: Math.min(seg + 1, i), to: Math.min(seg + 1, i) };
		cells.push({ from: line.from + pos.from, to: line.from + pos.to });
		seg = i + 1;
	}
	return cells;
}

export type Align = 'left' | 'center' | 'right' | null;

/** A table as cell text: rows[0] is the header, the delimiter row is aligns. */
export interface TableModel {
	rows: string[][];
	aligns: Align[];
}

export function readTable(state: EditorState, t: TableRange): TableModel {
	const first = state.doc.lineAt(t.start).number;
	const last = state.doc.lineAt(t.to).number;
	const cellsOf = (n: number) =>
		rowCells(state, state.doc.line(n)).map((c) => state.sliceDoc(c.from, c.to));
	const rows = [cellsOf(first)];
	for (let n = first + 2; n <= last; n++) rows.push(cellsOf(n));
	const width = rows[0].length;
	const aligns = cellsOf(first + 1).map((d): Align => {
		const l = d.startsWith(':');
		const r = d.endsWith(':');
		return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
	});
	for (const row of rows) while (row.length < width) row.push('');
	while (aligns.length < width) aligns.push(null);
	return { rows, aligns: aligns.slice(0, width) };
}

/** Markdown for a model, plus where each cell's content starts in it. */
export function writeTable(m: TableModel): { text: string; cellPos: (row: number, col: number) => number } {
	const delim = m.aligns.map((a) =>
		a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'
	);
	const lines = [m.rows[0], delim, ...m.rows.slice(1)];
	const starts: number[][] = [];
	let text = '';
	lines.forEach((cells, i) => {
		if (i) text += '\n';
		const pos: number[] = [];
		text += '|';
		for (const c of cells) {
			text += ' ';
			pos.push(text.length);
			text += c + ' |';
		}
		if (i !== 1) starts.push(pos);
	});
	return { text, cellPos: (row, col) => starts[row][col] };
}
