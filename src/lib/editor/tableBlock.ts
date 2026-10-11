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
 * without tables never pay for it.
 */

import { StateField, type EditorState, type Range } from '@codemirror/state';
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

type Render = typeof import('$lib/print/renderNote').renderNoteToHtml;
let render: Render | null = null;
let loading: Promise<void> | null = null;
const loadRenderer = () =>
	(loading ??= import('$lib/print/renderNote').then((m) => {
		render = m.renderNoteToHtml;
	}));

const htmlCache = new Map<string, string>();
function tableHtml(source: string, noteDir: string | null): string | null {
	if (!render) return null;
	const key = `${noteDir ?? ''}\n${source}`;
	let html = htmlCache.get(key);
	if (html === undefined) {
		html = render(source, '', (url) => resolveAssetUrl(url, noteDir));
		htmlCache.set(key, html);
	}
	return html;
}

// Offset of the start of cell `cell` in a source row: past the optional
// leading pipe, then past one unescaped pipe per earlier cell.
function cellOffset(text: string, cell: number): number {
	let i = text.length - text.trimStart().length;
	if (text[i] === '|') i++;
	for (let c = 0; c < cell && i < text.length; c++) {
		while (i < text.length && !(text[i] === '|' && text[i - 1] !== '\\')) i++;
		i++;
	}
	while (text[i] === ' ') i++;
	return Math.min(i, text.length);
}

class TableWidget extends WidgetType {
	constructor(
		readonly source: string,
		readonly noteDir: string | null
	) {
		super();
	}
	eq(other: TableWidget) {
		return other.source === this.source && other.noteDir === this.noteDir;
	}
	// Rows minus the delimiter line, so a fresh widget doesn't flap the
	// viewport before it is measured (see BlockMathWidget).
	get estimatedHeight(): number {
		return 16 + (this.source.split('\n').length - 1) * 34;
	}
	toDOM(view: EditorView) {
		const div = document.createElement('div');
		div.className = 'cm-table-block';
		const html = tableHtml(this.source, this.noteDir);
		if (html !== null) {
			div.innerHTML = html;
		} else {
			div.textContent = this.source;
			div.classList.add('cm-table-pending');
			void loadRenderer().then(() => {
				if (!div.isConnected) return;
				div.classList.remove('cm-table-pending');
				div.innerHTML = tableHtml(this.source, this.noteDir) ?? '';
				view.requestMeasure();
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
			const href = resolveAssetUrl(link.getAttribute('href') ?? '', this.noteDir);
			if (href) window.open(href, '_blank', 'noopener,noreferrer');
			e.preventDefault();
			return;
		}
		e.preventDefault();
		const start = view.posAtDOM(div);
		const first = view.state.doc.lineAt(start).number;
		const rows = Array.from(div.querySelectorAll('tr'));
		const row = rows.indexOf(target.closest('tr') as HTMLTableRowElement);
		// Rendered row 0 is the header line; body rows sit after the
		// delimiter line, hence the +1.
		const lineNo = Math.min(first + (row <= 0 ? 0 : row + 1), view.state.doc.lines);
		const line = view.state.doc.line(lineNo);
		const cellEl = target.closest('td, th');
		const cell = cellEl ? Array.from(cellEl.parentElement?.children ?? []).indexOf(cellEl) : 0;
		view.dispatch({ selection: { anchor: line.from + cellOffset(line.text, Math.max(0, cell)) } });
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

function buildTableDecorations(state: EditorState): DecorationSet {
	const noteDir = state.field(noteDirField, false) ?? null;
	const ranges: Range<Decoration>[] = [];
	for (const t of findTableRanges(state)) {
		if (isRangeActive(state, t.from, t.to)) {
			for (let n = state.doc.lineAt(t.from).number; n <= state.doc.lineAt(t.to).number; n++) {
				ranges.push(sourceLine.range(state.doc.line(n).from));
			}
		} else {
			ranges.push(
				Decoration.replace({ widget: new TableWidget(t.source, noteDir), block: true }).range(
					t.from,
					t.to
				)
			);
		}
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
			tr.effects.some((e) => e.is(previewModeEffect) || e.is(noteDirEffect))
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
