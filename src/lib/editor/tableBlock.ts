/**
 * GFM tables as a StateField, same shape as mathBlock.ts.
 *
 * Off the table (and its neighbour lines) the whole table is one block
 * widget rendered by the print/share renderer, so cells look the same in
 * the editor, PDFs and share links. On it, the raw markdown comes back in
 * monospace so the pipes line up while editing. A click on a rendered
 * cell puts the cursor in that cell's source.
 *
 * The renderer (markdown-it) is loaded on the first table, so notes
 * without tables never pay for it. Lezer and markdown-it don't always agree
 * on where a table ends, so a table only becomes a widget when the render
 * is exactly one table with a row per source row; anything else stays raw.
 */

import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import {
	isPreviewMode,
	noteDirEffect,
	noteDirField,
	previewModeEffect,
	resolveAssetUrl,
	setPreviewMode
} from './livePreview';
import { findTableRanges } from './tableRanges';
import { findMathBlockRanges, inlineMathRegex } from './mathRanges';
import { parseFrontmatter } from './frontmatter';
import { findWikilinksInText } from './wikilinks';

type Render = typeof import('$lib/print/renderNote').renderNoteToHtml;
let render: Render | null = null;
let loading: Promise<void> | null = null;
const loadRenderer = () =>
	(loading ??= import('$lib/print/renderNote').then((m) => {
		render = m.renderNoteToHtml;
	}));

// Dispatched once the renderer has loaded, so pending widgets rebuild.
const rendererReady = StateEffect.define<null>();

// Rendered tables by note folder + source, oldest dropped first. The bound
// is on top of the open note's own tables (see buildTableDecorations), so a
// note with many tables never evicts its own while rebuilding.
const htmlCache = new Map<string, string>();
const CACHE_SPARE = 200;

/**
 * HTML for a table, null until the renderer has loaded, '' when the render
 * is not exactly one table with `rows` rows. `refs` are the note's link
 * reference definitions, which a table cell may use.
 */
function tableHtml(
	source: string,
	refs: string,
	rows: number,
	noteDir: string | null
): string | null {
	if (!render) return null;
	const key = `${noteDir ?? ''}\n${source}\n${refs}`;
	let html = htmlCache.get(key);
	if (html === undefined) {
		html = render(refs ? `${source}\n\n${refs}` : source, '', (url) =>
			resolveAssetUrl(url, noteDir)
		);
		const tpl = document.createElement('template');
		tpl.innerHTML = html;
		const [table, ...rest] = Array.from(tpl.content.children);
		if (rest.length || !(table instanceof HTMLTableElement) || table.rows.length !== rows)
			html = '';
	} else {
		htmlCache.delete(key);
	}
	htmlCache.set(key, html);
	return html;
}

/**
 * Spans in a source row whose pipes don't split cells: the renderer swaps
 * inline code, inline math and wikilinks out before markdown-it sees the
 * row, in that order, each pass over the text the last one left. Masking
 * each span before the next pass repeats that. Offsets are relative to the
 * row.
 */
function protectedSpans(
	state: EditorState,
	from: number,
	text: string
): { from: number; to: number }[] {
	const spans: { from: number; to: number }[] = [];
	let masked = text;
	const mask = (found: { from: number; to: number }[]) => {
		for (const s of found) {
			spans.push(s);
			masked = masked.slice(0, s.from) + 'x'.repeat(s.to - s.from) + masked.slice(s.to);
		}
	};
	const code: { from: number; to: number }[] = [];
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
	mask(findWikilinksInText(masked));
	return spans;
}

// Offset of the start of cell `cell` in a source row: past the optional
// leading pipe, then past one splitting pipe per earlier cell.
function cellOffset(text: string, cell: number, spans: { from: number; to: number }[]): number {
	const splits = (i: number) =>
		text[i] === '|' && text[i - 1] !== '\\' && !spans.some((s) => i >= s.from && i < s.to);
	let i = text.length - text.trimStart().length;
	if (text[i] === '|') i++;
	for (let c = 0; c < cell && i < text.length; c++) {
		while (i < text.length && !splits(i)) i++;
		i++;
	}
	while (text[i] === ' ') i++;
	return Math.min(i, text.length);
}

class TableWidget extends WidgetType {
	// html is null while the renderer loads.
	constructor(
		readonly source: string,
		readonly html: string | null,
		readonly noteDir: string | null
	) {
		super();
	}
	eq(other: TableWidget) {
		return (
			other.source === this.source && other.html === this.html && other.noteDir === this.noteDir
		);
	}
	// Rows minus the delimiter line, so a fresh widget doesn't flap the
	// viewport before it is measured (see BlockMathWidget).
	get estimatedHeight(): number {
		return 16 + (this.source.split('\n').length - 1) * 34;
	}
	toDOM(view: EditorView) {
		const div = document.createElement('div');
		div.className = 'cm-table-block';
		if (this.html !== null) {
			div.innerHTML = this.html;
		} else {
			div.textContent = this.source;
			div.classList.add('cm-table-pending');
			void loadRenderer().then(() => {
				if (div.isConnected) view.dispatch({ effects: rendererReady.of(null) });
			});
		}
		div.addEventListener('mousedown', (e) => this.onMouseDown(e, view, div));
		// Links in cells never navigate on a plain click; the mousedown above
		// already moved the cursor into the source.
		div.addEventListener('click', (e) => {
			if ((e.target as Element).closest('a')) e.preventDefault();
		});
		return div;
	}
	onMouseDown(e: MouseEvent, view: EditorView, div: HTMLElement) {
		if (e.button !== 0) return;
		const target = e.target as Element;
		const link = target.closest('a');
		if (link && (e.ctrlKey || e.metaKey)) {
			// markdown-it percent-encodes the href and resolveAssetUrl encodes
			// each path segment again, so a relative one is decoded fully first.
			let href = link.getAttribute('href') ?? '';
			if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/')) {
				try {
					href = decodeURIComponent(href);
				} catch {}
			}
			const url = resolveAssetUrl(href, this.noteDir);
			if (url) window.open(url, '_blank', 'noopener,noreferrer');
			e.preventDefault();
			return;
		}
		e.preventDefault();
		const start = view.posAtDOM(div);
		const first = view.state.doc.lineAt(start).number;
		const rows = Array.from(div.querySelectorAll('tr'));
		const row = rows.indexOf(target.closest('tr') as HTMLTableRowElement);
		// Rendered row 0 is the header line; body rows sit after the
		// delimiter line, hence the +1. The row count matches the source
		// (see tableHtml); while pending there are no rows: the header.
		const lineNo = Math.min(first + (row <= 0 ? 0 : row + 1), view.state.doc.lines);
		const line = view.state.doc.line(lineNo);
		const cellEl = target.closest('td, th');
		const cell = cellEl ? Array.from(cellEl.parentElement?.children ?? []).indexOf(cellEl) : 0;
		const spans = protectedSpans(view.state, line.from, line.text);
		const pos = line.from + cellOffset(line.text, Math.max(0, cell), spans);
		view.dispatch({
			selection: {
				anchor: e.shiftKey ? view.state.selection.main.anchor : pos,
				head: pos
			}
		});
		// Leave preview only after reading positions: the rebuild it
		// triggers swaps this widget out for the source lines.
		if (isPreviewMode()) setPreviewMode(view, false);
		view.focus();
	}
	ignoreEvent() {
		return true;
	}
}

// Same one-line grace as math blocks: a replaced block hides its lines, so
// revealing from the neighbour line keeps every arrow motion native.
function isRangeActive(state: EditorState, from: number, to: number): boolean {
	if (isPreviewMode()) return false;
	const cursorLine = state.doc.lineAt(state.selection.main.head).number;
	return (
		cursorLine >= state.doc.lineAt(from).number - 1 && cursorLine <= state.doc.lineAt(to).number + 1
	);
}

const sourceLine = Decoration.line({ class: 'cm-table-source' });

const REF_CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

// The note's `[ref]: url` definitions (any depth, quote and indent prefixes
// dropped), appended to each table's render so reference links in cells
// resolve like they do in the full note. Frontmatter and display math are
// not markdown to the renderer, so definitions there don't count.
function linkReferences(state: EditorState): string {
	const fmEnd = parseFrontmatter(state.doc.toString())?.bodyStart ?? 0;
	const math = findMathBlockRanges(state);
	const refs: string[] = [];
	syntaxTree(state).iterate({
		enter: (n) => {
			if (n.name === 'LinkReference') {
				if (n.from >= fmEnd && !math.some((r) => n.from < r.to && r.from < n.to)) {
					refs.push(state.doc.sliceString(n.from, n.to).replace(/^[ \t]*(?:>[ \t]?)*/gm, ''));
				}
				return false;
			}
			return REF_CONTAINERS.has(n.name);
		}
	});
	return refs.join('\n');
}

function buildTableDecorations(state: EditorState): DecorationSet {
	const tables = findTableRanges(state);
	if (!tables.length) return Decoration.none;
	const noteDir = state.field(noteDirField, false) ?? null;
	const refs = linkReferences(state);
	const ranges: Range<Decoration>[] = [];
	for (const t of tables) {
		const first = state.doc.lineAt(t.from).number;
		const last = state.doc.lineAt(t.to).number;
		// Header and body rows; the delimiter line renders no row.
		const html = isRangeActive(state, t.from, t.to)
			? ''
			: tableHtml(t.source, refs, last - first, noteDir);
		if (html === '') {
			for (let n = first; n <= last; n++) ranges.push(sourceLine.range(state.doc.line(n).from));
		} else {
			ranges.push(
				Decoration.replace({
					widget: new TableWidget(t.source, html, noteDir),
					block: true
				}).range(t.from, t.to)
			);
		}
	}
	while (htmlCache.size > CACHE_SPARE + tables.length) {
		htmlCache.delete(htmlCache.keys().next().value!);
	}
	return Decoration.set(ranges, true);
}

export const tableBlockField = StateField.define<DecorationSet>({
	create: (state) => buildTableDecorations(state),
	update(deco, tr) {
		if (
			tr.docChanged ||
			tr.reconfigured ||
			syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
			tr.effects.some((e) => e.is(previewModeEffect) || e.is(noteDirEffect) || e.is(rendererReady))
		) {
			return buildTableDecorations(tr.state);
		}
		// Active state is line-based: same-line motion reuses the set.
		if (tr.selection) {
			const before = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
			const after = tr.state.doc.lineAt(tr.state.selection.main.head).number;
			if (before !== after) return buildTableDecorations(tr.state);
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});
