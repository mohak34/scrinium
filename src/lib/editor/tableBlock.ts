/**
 * GFM tables as a StateField, same shape as mathBlock.ts.
 *
 * A table is always one block widget rendered by the print/share renderer,
 * so cells look the same in the editor, PDFs and share links. Editing is
 * per cell: when the main selection sits inside one cell, a small editor
 * opens in that cell showing its raw markdown, and every edit in it is
 * written straight into the note (see syncCell). The live-preview rule
 * moves from the line to the cell. "Edit table as markdown" shows the raw
 * lines until the cursor leaves the table.
 *
 * The renderer (markdown-it) is loaded on the first table, so notes
 * without tables never pay for it. Lezer and markdown-it don't always agree
 * on where a table ends, so a table only becomes a widget when the render
 * is exactly one table with a row per source row; anything else stays raw.
 */

import {
	Annotation,
	EditorSelection,
	EditorState,
	Facet,
	Prec,
	StateEffect,
	StateField,
	Transaction,
	type Range
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	keymap,
	type DecorationSet
} from '@codemirror/view';
import { defaultKeymap, redo, undo } from '@codemirror/commands';
import {
	autocompletion,
	startCompletion,
	type CompletionContext,
	type CompletionResult
} from '@codemirror/autocomplete';
import {
	isPreviewMode,
	noteDirEffect,
	noteDirField,
	previewModeEffect,
	setPreviewMode
} from './livePreview';
import { resolveAssetUrl } from '$lib/attachments';
import {
	findTableRanges,
	readTable,
	rowCells,
	writeTable,
	type Align,
	type TableModel,
	type TableRange
} from './tableRanges';
import { findMathBlockRanges } from './mathRanges';
import { fmEnd, perDoc } from './docRanges';
import { toggleWrap } from './formatting';
import {
	DATE_RANGE_LABEL,
	colType,
	isDate,
	localDay,
	metaLine,
	shiftCols,
	statusColor,
	statusOptions,
	tableView,
	type ColFilter,
	type ColType,
	type DateRange,
	type TableMeta
} from './tableMeta';
import type { ContextMenuItem } from '$lib/components/ContextMenu.svelte';

type Render = typeof import('$lib/print/renderNote').renderNoteToHtml;
let render: Render | null = null;
let loading: Promise<void> | null = null;
// KaTeX's CSS comes along for math in cells: the editor otherwise only
// loads it with its own math widgets (mathRender.ts).
const loadRenderer = () =>
	(loading ??= Promise.all([import('$lib/print/renderNote'), import('katex/dist/katex.min.css')]).then(
		([m]) => {
			render = m.renderNoteToHtml;
		}
	));

// Dispatched once the renderer has loaded, so pending widgets rebuild.
const rendererReady = StateEffect.define<null>();

// Rendered tables by note folder + source, oldest dropped first. The bound
// is on top of the open note's own tables (see buildTableDecorations), so a
// note with many tables never evicts its own while rebuilding.
const htmlCache = new Map<string, string>();
const CACHE_SPARE = 200;
function trimCache(noteTables: number) {
	while (htmlCache.size > CACHE_SPARE + noteTables) {
		htmlCache.delete(htmlCache.keys().next().value!);
	}
}

const tableKey = (source: string, refs: string, noteDir: string | null) =>
	`${noteDir ?? ''}\n${source}\n${refs}`;

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
	const key = tableKey(source, refs, noteDir);
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

// The widget each table DOM currently shows: CodeMirror reuses a table's
// DOM across edits (updateDOM), so listeners read the live widget here.
const widgets = new WeakMap<HTMLElement, TableWidget>();
// The body rows each table DOM shows, as source body indexes in display
// order (sort and filter), so clicks and keys map rows both ways.
const orders = new WeakMap<HTMLElement, number[]>();

// Display orders by settings, kept row and source, so typing elsewhere in
// the note never re-reads a sorted table.
const orderCache = new Map<string, number[]>();

const hasFilter = (meta: TableMeta | null) => Object.keys(meta?.filter ?? {}).length > 0;
const hasView = (meta: TableMeta | null) => !!meta?.sort || hasFilter(meta);

// The body row the cursor is in, for a filtered table it is in, else null.
function keepRow(state: EditorState, t: TableRange): number | null {
	const head = state.selection.main.head;
	if (!hasFilter(t.meta) || head < t.start || head > t.to) return null;
	const row = state.doc.lineAt(head).number - state.doc.lineAt(t.start).number - 2;
	return row >= 0 ? row : null;
}

// Changes when the cursor moves to another row of a filtered table.
const keepKey = (state: EditorState) =>
	findTableRanges(state)
		.map((t) => keepRow(state, t))
		.join();

// The HTML renders on first paint: typing in a cell builds a widget per
// keystroke that never paints (see updateDOM).
class TableWidget extends WidgetType {
	private rendered: string | null | undefined;
	private viewOrder: number[] | undefined;
	readonly ready = render !== null;
	readonly metaKey: string;
	constructor(
		readonly source: string,
		readonly refs: string,
		readonly noteDir: string | null,
		readonly meta: TableMeta | null,
		// The body row the cursor is in, which filters never hide.
		readonly keep: number | null,
		// Source cell text of the body rows, read only when sorted or filtered.
		readonly body: () => string[][]
	) {
		super();
		this.metaKey = meta ? metaLine(meta) : '';
	}
	/** Source body indexes in display order. */
	get order(): number[] {
		if (this.viewOrder) return this.viewOrder;
		const count = this.source.split('\n').length - 2;
		if (!hasView(this.meta)) return (this.viewOrder = Array.from({ length: count }, (_, i) => i));
		const key = `${this.metaKey}\n${this.keep}\n${localDay()}\n${this.source}`;
		let order = orderCache.get(key);
		if (!order) {
			order = tableView(this.body(), this.meta, this.keep);
			orderCache.set(key, order);
			while (orderCache.size > 20) orderCache.delete(orderCache.keys().next().value!);
		}
		return (this.viewOrder = order);
	}
	/** The markdown rendered: header, delimiter, then body rows in display order. */
	get shownSource(): string {
		if (!hasView(this.meta)) return this.source;
		const lines = this.source.split('\n');
		return [lines[0], lines[1], ...this.order.map((i) => lines[i + 2])].join('\n');
	}
	// null while the renderer loads, '' when the source is not one table.
	get html(): string | null {
		if (this.rendered === undefined)
			this.rendered = tableHtml(this.shownSource, this.refs, this.order.length + 1, this.noteDir);
		return this.rendered;
	}
	get cached(): boolean {
		return (
			this.rendered !== undefined ||
			(!hasView(this.meta) && htmlCache.has(tableKey(this.source, this.refs, this.noteDir)))
		);
	}
	eq(other: TableWidget) {
		return (
			other.source === this.source &&
			other.refs === this.refs &&
			other.noteDir === this.noteDir &&
			other.ready === this.ready &&
			other.metaKey === this.metaKey &&
			other.keep === this.keep
		);
	}
	// Rows minus the delimiter line, so a fresh widget doesn't flap the
	// viewport before it is measured (see BlockMathWidget).
	get estimatedHeight(): number {
		return 16 + (hasView(this.meta) ? 28 : 0) + (this.order.length + 1) * 34;
	}
	toDOM(view: EditorView) {
		const div = document.createElement('div');
		div.className = 'cm-table-block';
		this.paint(div, view);
		div.addEventListener('mousedown', (e) => onTableMouseDown(e, view, div));
		// Links in cells never navigate on a plain click; the mousedown
		// already moved the cursor into the cell.
		div.addEventListener('click', (e) => {
			if ((e.target as Element).closest('.cm-table-block a')) e.preventDefault();
		});
		return div;
	}
	updateDOM(dom: HTMLElement, view: EditorView) {
		// Typing in a cell only changes that cell, which shows its editor, so
		// the rest of the table is already right.
		if (!(echoing && edit?.host === dom)) this.paint(dom, view);
		else widgets.set(dom, this);
		return true;
	}
	paint(div: HTMLElement, view: EditorView) {
		widgets.set(div, this);
		// Repainting drops a mounted cell editor; syncCell mounts it again.
		if (edit?.host === div && edit.cell.hasFocus) edit.refocus = true;
		const html = this.html;
		div.classList.toggle('cm-table-pending', html === null);
		if (html !== null) {
			div.innerHTML = html;
			orders.set(div, this.order);
			if (html) this.dress(div);
		} else {
			div.textContent = this.source;
			void loadRenderer().then(() => {
				if (div.isConnected) view.dispatch({ effects: rendererReady.of(null) });
			});
		}
	}
	/** Column menu buttons, typed cell styles and the sort/filter line. */
	dress(div: HTMLElement) {
		const table = div.querySelector('table');
		if (!table) return;
		const meta = this.meta;
		const header = table.rows[0];
		const names = Array.from(header?.cells ?? [], (th) => th.textContent?.trim() ?? '');
		Array.from(header?.cells ?? []).forEach((th, col) => {
			const sorted = meta?.sort?.col === col ? meta.sort.dir : 0;
			const filtered = !!meta?.filter?.[col];
			const btn = document.createElement('span');
			btn.className = 'cm-th-menu material-symbols-outlined';
			btn.classList.toggle('on', !!sorted || filtered);
			btn.textContent = sorted > 0 ? 'arrow_upward' : sorted < 0 ? 'arrow_downward' : filtered ? 'filter_list' : 'arrow_drop_down';
			th.append(btn);
		});
		const typed = Object.entries(meta?.cols ?? {}).filter(([, c]) => c.type !== 'text');
		if (typed.length) {
			const body = this.body();
			const today = localDay();
			const soon = localDay(7);
			for (const [k, c] of typed) {
				const col = Number(k);
				const options = c.type === 'status' ? statusOptions(meta, col, body.map((r) => r[col] ?? '')) : [];
				this.order.forEach((src, i) => {
					const td = table.rows[i + 1]?.cells[col];
					const v = body[src]?.[col] ?? '';
					if (!td || !v) return;
					if (c.type === 'number') td.classList.add('cm-cell-num');
					else if (c.type === 'status') {
						td.classList.add('cm-cell-status');
						td.style.setProperty('--status', statusColor(options, v));
					} else if (c.type === 'deadline' && isDate(v)) {
						td.classList.toggle('cm-cell-over', v < today);
						td.classList.toggle('cm-cell-near', v >= today && v <= soon);
					}
				});
			}
		}
		if (!hasView(meta)) return;
		const bar = document.createElement('div');
		bar.className = 'cm-table-bar';
		const add = (html: string, clear: string) => {
			const item = document.createElement('span');
			item.className = 'cm-table-chip';
			item.innerHTML = html;
			const x = document.createElement('span');
			x.className = 'material-symbols-outlined';
			x.dataset.clear = clear;
			x.textContent = 'close';
			item.append(x);
			bar.append(item);
		};
		const name = (col: number) => `<b>${escapeHtml(names[col] || `Column ${col + 1}`)}</b>`;
		for (const [k, f] of Object.entries(meta!.filter ?? {})) {
			add(`${name(Number(k))} ${escapeHtml(filterText(f))}`, `filter:${k}`);
		}
		if (meta!.sort) add(`sorted by ${name(meta!.sort.col)} ${meta!.sort.dir > 0 ? 'ascending' : 'descending'}`, 'sort');
		const total = this.source.split('\n').length - 2;
		const count = document.createElement('span');
		count.className = 'cm-table-count';
		count.textContent = `${this.order.length} of ${total} rows`;
		bar.append(count);
		div.prepend(bar);
	}
	destroy(dom: HTMLElement) {
		if (edit?.host === dom) closeCell();
	}
	ignoreEvent() {
		return true;
	}
}

const escapeHtml = (s: string) =>
	s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function filterText(f: ColFilter): string {
	const parts: string[] = [];
	if (f.hide?.length) parts.push(`hides ${f.hide.join(', ')}`);
	if (f.date) parts.push(DATE_RANGE_LABEL[f.date]);
	if (f.filled) parts.push('not empty');
	return parts.join(', ');
}

/** Where a press on the rendered table opens its cell editor. */
let pendingClick: { x: number; y: number } | null = null;

function onTableMouseDown(e: MouseEvent, view: EditorView, div: HTMLElement) {
	if (e.button !== 0) return;
	const target = e.target as Element;
	if (edit?.host === div && edit.cell.dom.contains(target)) return;
	const widget = widgets.get(div);
	const clear = target.closest<HTMLElement>('[data-clear]')?.dataset.clear;
	const menuBtn = target.closest('.cm-th-menu');
	if (clear || menuBtn || target.closest('.cm-table-bar')) {
		e.preventDefault();
		const t = tableAt(view.state, view.posAtDOM(div));
		if (!t) return;
		if (clear) {
			const meta = { ...(t.meta ?? { v: 1 as const }) };
			if (clear === 'sort') delete meta.sort;
			else {
				meta.filter = { ...meta.filter };
				delete meta.filter[clear.slice('filter:'.length)];
			}
			setMeta(view, t, meta);
		} else if (menuBtn) {
			const th = menuBtn.closest('th');
			const col = th ? Array.from(th.parentElement?.children ?? []).indexOf(th) : -1;
			const r = menuBtn.getBoundingClientRect();
			if (col >= 0) openColumnMenu(view, t, col, r.left, r.bottom + 4);
		}
		return;
	}
	const link = target.closest('a');
	if (link && widget && (e.ctrlKey || e.metaKey)) {
		// markdown-it percent-encodes the href and resolveAssetUrl encodes
		// each path segment again, so a relative one is decoded fully first.
		let href = link.getAttribute('href') ?? '';
		if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/')) {
			try {
				href = decodeURIComponent(href);
			} catch {}
		}
		const url = resolveAssetUrl(href, widget.noteDir);
		if (url) window.open(url, '_blank', 'noopener,noreferrer');
		e.preventDefault();
		return;
	}
	// A wide table scrolls itself; a press below its client box is on
	// the scrollbar, so the browser keeps it.
	if (
		target instanceof HTMLTableElement &&
		e.clientY >= target.getBoundingClientRect().top + target.clientTop + target.clientHeight
	)
		return;
	e.preventDefault();
	const t = tableAt(view.state, view.posAtDOM(div));
	if (!t) return;
	const rows = Array.from(div.querySelectorAll('tr'));
	const row = sourceRow(div, Math.max(0, rows.indexOf(target.closest('tr') as HTMLTableRowElement)));
	const cellEl = target.closest('td, th');
	const col = cellEl ? Math.max(0, Array.from(cellEl.parentElement?.children ?? []).indexOf(cellEl)) : 0;
	const cells = rowCells(view.state, rowLine(view.state, t, row));
	pendingClick = { x: e.clientX, y: e.clientY };
	if (col < cells.length) {
		const pos = cells[col].to;
		view.dispatch({
			selection: { anchor: e.shiftKey ? view.state.selection.main.anchor : pos, head: pos }
		});
	} else {
		// A short row: the renderer pads it, the source doesn't have the cell
		// yet, so write the table out whole first.
		rewriteTable(view, t, readTable(view.state, t), row, col);
	}
	// Leave preview only after reading positions: the rebuild it triggers
	// can swap this widget's DOM.
	if (isPreviewMode()) setPreviewMode(view, false);
	view.focus();
}

// Display row (0 the header) to source row, through the painted order.
function sourceRow(host: HTMLElement, row: number): number {
	const order = orders.get(host);
	return row === 0 || !order ? row : (order[row - 1] ?? row - 1) + 1;
}

/** Source rows in display order, the header first. */
function displayRows(view: EditorView, t: TableRange): number[] {
	const host = tableDom(view, t);
	const order = host && orders.get(host);
	if (order) return [0, ...order.map((i) => i + 1)];
	return Array.from({ length: rowCount(view.state, t) }, (_, i) => i);
}

function tableAt(state: EditorState, pos: number): TableRange | null {
	return findTableRanges(state).find((t) => pos >= t.from && pos <= t.to) ?? null;
}

// Source line of rendered row `row`: row 0 is the header, body rows sit
// after the delimiter line.
function rowLine(state: EditorState, t: TableRange, row: number) {
	const first = state.doc.lineAt(t.start).number;
	return state.doc.line(Math.min(first + (row === 0 ? 0 : row + 1), state.doc.lines));
}

interface CellRef {
	table: TableRange;
	row: number;
	col: number;
	from: number;
	to: number;
}

// The cell holding `pos`: the last cell starting at or before it, so a
// position in a cell's padding counts as that cell. The delimiter line
// stands for the header.
function cellAt(state: EditorState, pos: number): CellRef | null {
	const table = tableAt(state, pos);
	if (!table) return null;
	const first = state.doc.lineAt(table.start).number;
	const n = state.doc.lineAt(pos).number;
	const row = n <= first + 1 ? 0 : n - first - 1;
	const cells = rowCells(state, rowLine(state, table, row));
	let col = 0;
	if (n !== first + 1) {
		cells.forEach((c, i) => {
			if (c.from <= pos) col = i;
		});
	}
	return cells.length ? { table, row, col, ...cells[col] } : null;
}

// The cell the whole main selection sits in, if it sits in one.
function selectedCell(state: EditorState): CellRef | null {
	const { anchor, head } = state.selection.main;
	const c = cellAt(state, head);
	if (!c || anchor < c.from || anchor > c.to) return null;
	return c;
}

const sameCell = (a: CellRef, b: { table: TableRange; row: number; col: number }) =>
	a.table.from === b.table.from && a.row === b.row && a.col === b.col;

// ---- The cell editor ----

interface CellEdit {
	main: EditorView;
	cell: EditorView;
	host: HTMLElement;
	ref: CellRef;
	refocus: boolean;
	// The cell's text when it opened, for its completions.
	opened: string;
}

// The open cell editor, at most one: the main view has one selection.
let edit: CellEdit | null = null;
// True while a cell edit is being written into the main doc.
let echoing = false;
// Marks cell-editor transactions that copy the main doc in, so they are
// not written back.
const fromMain = Annotation.define<boolean>();

function closeCell() {
	if (!edit) return;
	const { host, cell, main } = edit;
	edit = null;
	cell.destroy();
	const w = widgets.get(host);
	if (w && host.isConnected) w.paint(host, main);
}

function tableDom(view: EditorView, t: TableRange): HTMLElement | null {
	for (const d of view.contentDOM.querySelectorAll<HTMLElement>('.cm-table-block')) {
		if (!d.classList.contains('cm-table-pending') && view.posAtDOM(d) === t.from) return d;
	}
	return null;
}

// The rendered cell of source row `row`; null when a filter hides it.
function cellDom(host: HTMLElement, row: number, col: number): HTMLElement | null {
	const order = orders.get(host);
	const shown = row === 0 || !order ? row : order.indexOf(row - 1) + 1;
	if (shown < 0 || (row > 0 && shown === 0)) return null;
	const tr = host.querySelectorAll('tr')[shown];
	const td = tr?.children[col];
	return td instanceof HTMLElement ? td : null;
}

/** The main editor's vim mode, provided by CodeEditor (vim loads lazily). */
export interface TableVim {
	mode(view: EditorView): 'off' | 'normal' | 'insert';
	exitInsert(view: EditorView): void;
}
export const tableVim = Facet.define<TableVim, TableVim | null>({ combine: (v) => v[0] ?? null });

// The cell vim's normal-mode cursor is on while the table stays rendered.
let cursorTd: HTMLElement | null = null;
function markCursor(td: HTMLElement | null) {
	if (cursorTd === td) return;
	cursorTd?.classList.remove('cm-table-cursor');
	td?.classList.add('cm-table-cursor');
	cursorTd = td;
}

/**
 * Makes the cell editor match the main selection: open in the cell the
 * selection sits in, follow the main doc when it changes underneath (undo,
 * a rewrite), close when the selection leaves. A cell only opens while
 * the editor has focus, so loading a note never pulls focus into a table.
 * In vim normal mode the cursor moves through cells without opening them
 * (the cell is outlined); a click, `i` or `a` opens one.
 */
export function syncCell(view: EditorView) {
	const state = view.state;
	const mine = edit?.main === view ? edit : null;
	const click = pendingClick;
	pendingClick = null;
	const editing =
		!!mine?.cell.hasFocus ||
		!!mine?.refocus ||
		!!click ||
		state.facet(tableVim)?.mode(view) !== 'normal';
	const sel = state.selection.main;
	// While the selection is in a rendered table the main cursor (vim's
	// block cursor too) would draw as a bar down the widget's edge.
	const t = isPreviewMode() ? null : tableAt(state, sel.head);
	view.dom.classList.toggle('cm-in-table', !!t && state.field(rawTableField) !== t.from);
	// The open cell keeps its own range, mapped through every edit: the
	// trimmed source range would drop a space typed at the end of the cell.
	if (mine && editing && mine.cell.dom.isConnected && !isPreviewMode()) {
		const { from, to } = mine.ref;
		if (
			sel.from >= from &&
			sel.to <= to &&
			state.field(rawTableField) !== tableAt(state, from)?.from &&
			state.sliceDoc(from, to) === mine.cell.state.doc.toString()
		) {
			markCursor(null);
			if (view.hasFocus) mine.cell.focus();
			return;
		}
	}
	const ref = isPreviewMode() ? null : selectedCell(state);
	// A pipe or the padding around a cell counts as that cell: the vim
	// cursor can rest there, and `a` / `A` / `I` enter it there.
	const near = ref ?? (isPreviewMode() || !sel.empty ? null : cellAt(state, sel.head));
	const raw = state.field(rawTableField);
	if (!ref && near && editing && raw !== near.table.from) {
		view.dispatch({ selection: { anchor: Math.max(near.from, Math.min(near.to, sel.head)) } });
		return;
	}
	const focused = view.hasFocus || !!mine?.cell.hasFocus;
	if (!ref || raw === ref.table.from || !editing) {
		if (mine) closeCell();
		const host = near && raw !== near.table.from && view.hasFocus && tableDom(view, near.table);
		markCursor((host && cellDom(host, near.row, near.col)) || null);
		return;
	}
	markCursor(null);
	const host = tableDom(view, ref.table);
	const td = host && cellDom(host, ref.row, ref.col);
	if (!host || !td || (!focused && !(mine && sameCell(mine.ref, ref)))) {
		if (mine) closeCell();
		return;
	}
	const text = state.sliceDoc(ref.from, ref.to);
	const local = EditorSelection.single(sel.anchor - ref.from, sel.head - ref.from);
	if (mine && sameCell(mine.ref, ref)) {
		mine.ref = ref;
		if (mine.host !== host || mine.cell.dom.parentElement !== td) {
			td.replaceChildren(mine.cell.dom);
			mine.host = host;
		}
		const cur = mine.cell.state;
		if (cur.doc.toString() !== text || !cur.selection.main.eq(local.main)) {
			mine.cell.dispatch({
				changes: { from: 0, to: cur.doc.length, insert: text },
				selection: local,
				annotations: fromMain.of(true)
			});
		}
		if (view.hasFocus || mine.refocus) mine.cell.focus();
		mine.refocus = false;
		return;
	}
	// Closing repaints the table it was in, so find the cell again after.
	closeCell();
	const freshHost = tableDom(view, ref.table);
	const freshTd = freshHost && cellDom(freshHost, ref.row, ref.col);
	if (!freshHost || !freshTd) return;
	freshTd.replaceChildren();
	const cell = new EditorView({
		parent: freshTd,
		state: EditorState.create({ doc: text, selection: local, extensions: cellExtensions })
	});
	edit = { main: view, cell, host: freshHost, ref, refocus: false, opened: text };
	if (click) {
		const pos = cell.posAtCoords(click);
		if (pos !== null) cell.dispatch({ selection: { anchor: pos } });
	}
	cell.focus();
	startCompletion(cell);
}

/**
 * The values used in the open cell's column, when the column repeats a
 * value: a status column then edits like a select, while a free text
 * column (every value different) offers nothing. `own` adds the open
 * cell's value, left out once edited so a half-typed word is no choice.
 */
function columnChoices(own: boolean): string[] {
	if (!edit || edit.ref.row === 0) return [];
	const { main, ref } = edit;
	const t = tableAt(main.state, ref.from);
	if (!t) return [];
	const column = readTable(main.state, t).rows.map((r) => r[ref.col]);
	if (colType(t.meta, ref.col) === 'status') return statusOptions(t.meta, ref.col, column.slice(1));
	const filled = column.slice(1).filter(Boolean);
	if (new Set(filled).size === filled.length) return [];
	const others = column.filter((v, i) => v && i > 0 && (own || i !== ref.row));
	return [...new Set(others)].sort((a, b) => a.localeCompare(b));
}

// A cell lists every choice until it is edited, to show what a filled
// cell can change to; typing filters them.
function cellCompletions(ctx: CompletionContext): CompletionResult | null {
	const untouched = ctx.state.doc.toString() === edit?.opened;
	const choices = columnChoices(untouched);
	if (!choices.length) return null;
	return {
		from: 0,
		to: ctx.state.doc.length,
		options: choices.map((label) => ({ label })),
		filter: !untouched
	};
}

// Copy cell edits and caret moves into the main doc, as one transaction
// per cell transaction so undo groups typing like the main editor.
const writeBack = EditorView.updateListener.of((u) => {
	if (!edit || edit.cell !== u.view) return;
	if (u.transactions.some((tr) => tr.annotation(fromMain))) return;
	if (!u.docChanged && !u.selectionSet) return;
	const { main, ref } = edit;
	const changes: { from: number; to: number; insert: string }[] = [];
	u.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
		changes.push({ from: ref.from + fromA, to: ref.from + toA, insert: ins.toString() });
	});
	const sel = u.state.selection.main;
	const event = u.transactions.map((tr) => tr.annotation(Transaction.userEvent)).find(Boolean);
	echoing = true;
	try {
		main.dispatch({
			changes,
			selection: { anchor: ref.from + sel.anchor, head: ref.from + sel.head },
			userEvent: event ?? (u.docChanged ? 'input' : 'select')
		});
	} finally {
		echoing = false;
	}
});

// A bare `|` would split the cell and a newline the table, so after every
// edit (a typed pipe, or a deleted backslash in front of one) pipes are
// escaped and newlines become spaces. The fix-up runs after the edit, so the
// edit's own selection maps through it.
const cellInputFilter = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || tr.annotation(fromMain)) return tr;
	const text = tr.newDoc.toString();
	const fixes: { from: number; to?: number; insert: string }[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\n') fixes.push({ from: i, to: i + 1, insert: ' ' });
		else if (text[i] === '|' && text[i - 1] !== '\\') fixes.push({ from: i, insert: '\\' });
	}
	if (!fixes.length) return tr;
	return [tr, { changes: fixes, sequential: true }];
});

/** Moves the main cursor to the end of a cell; syncCell then opens it. */
function gotoCell(main: EditorView, t: TableRange, row: number, col: number) {
	const cells = rowCells(main.state, rowLine(main.state, t, row));
	const c = cells[Math.min(col, cells.length - 1)];
	if (c) main.dispatch({ selection: { anchor: c.to }, scrollIntoView: true });
}

/** Puts the main cursor on the line before or after the table. */
function leaveTable(main: EditorView, t: TableRange, after: boolean) {
	const doc = main.state.doc;
	if (after) {
		if (t.to < doc.length) main.dispatch({ selection: { anchor: t.to + 1 }, scrollIntoView: true });
		else main.dispatch({ changes: { from: t.to, insert: '\n' }, selection: { anchor: t.to + 1 } });
	} else if (t.from > 0) {
		main.dispatch({ selection: { anchor: t.from - 1 }, scrollIntoView: true });
	} else {
		main.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 } });
	}
	main.focus();
}

function rowCount(state: EditorState, t: TableRange): number {
	return state.doc.lineAt(t.to).number - state.doc.lineAt(t.start).number;
}

// Cell keys: steps between cells, out of the table at its edges.
function step(dir: 'next' | 'prev' | 'up' | 'down' | 'left' | 'right') {
	return (cell: EditorView): boolean => {
		if (!edit || edit.cell !== cell) return false;
		const { main, ref } = edit;
		const s = cell.state.selection.main;
		if (dir === 'left' && (!s.empty || s.head > 0)) return false;
		if (dir === 'right' && (!s.empty || s.head < cell.state.doc.length)) return false;
		if (dir === 'up' || dir === 'down') {
			// Wrapped cells move by visual line first.
			const next = cell.moveVertically(s, dir === 'down');
			if (next.head !== s.head && cell.coordsAtPos(next.head)?.top !== cell.coordsAtPos(s.head)?.top)
				return false;
		}
		const t = tableAt(main.state, ref.from);
		if (!t) return false;
		// Rows step in display order (sort and filter), by index into `rows`.
		const rows = displayRows(main, t);
		const cols = rowCells(main.state, rowLine(main.state, t, ref.row)).length;
		const { row, col } = ref;
		const at = Math.max(0, rows.indexOf(row));
		const last = rows.length - 1;
		if (dir === 'up' || dir === 'down') {
			const next = at + (dir === 'down' ? 1 : -1);
			if (next < 0 || next > last) leaveTable(main, t, next > last);
			else gotoCell(main, t, rows[next], col);
		} else if (dir === 'next' || dir === 'right') {
			if (col < cols - 1) gotoCell(main, t, row, col + 1);
			else if (at < last) gotoCell(main, t, rows[at + 1], 0);
			else if (dir === 'right') leaveTable(main, t, true);
			else rewriteTable(main, t, withRow(readTable(main.state, t)), Infinity, 0);
		} else if (col > 0) {
			gotoCell(main, t, row, col - 1);
		} else if (at > 0) {
			gotoCell(main, t, rows[at - 1], Infinity);
		} else {
			leaveTable(main, t, false);
		}
		return true;
	};
}

const withRow = (m: TableModel) => (m.rows.push(m.rows[0].map(() => '')), m);

// Enter: the same column one row down, adding a row at the bottom.
function enterKey(cell: EditorView): boolean {
	if (!edit || edit.cell !== cell) return false;
	const { main, ref } = edit;
	const t = tableAt(main.state, ref.from);
	if (!t) return false;
	const rows = displayRows(main, t);
	const at = Math.max(0, rows.indexOf(ref.row));
	if (at < rows.length - 1) gotoCell(main, t, rows[at + 1], ref.col);
	else rewriteTable(main, t, withRow(readTable(main.state, t)), Infinity, ref.col);
	return true;
}

const onMain = (cmd: (view: EditorView) => boolean) => (cell: EditorView) =>
	!!edit && edit.cell === cell && (cmd(edit.main), true);

// The completion keymap runs before the cell keys, so while the list is
// open Up/Down/Enter/Esc work it and Tab still steps to the next cell.
const cellExtensions = [
	EditorView.lineWrapping,
	cellInputFilter,
	writeBack,
	autocompletion({ override: [cellCompletions], icons: false }),
	// The note theme styles the list, but inside the cell editor its own
	// base styles are more specific for these two.
	EditorView.theme(
		{
			'.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)' },
			'.cm-tooltip-autocomplete ul li[aria-selected]': {
				backgroundColor: 'var(--hover)',
				color: 'var(--text)'
			}
		},
		{ dark: true }
	),
	Prec.high(
		keymap.of([
			{ key: 'Tab', run: step('next') },
			{ key: 'Shift-Tab', run: step('prev') },
			{ key: 'Enter', run: enterKey },
			{ key: 'ArrowUp', run: step('up') },
			{ key: 'ArrowDown', run: step('down') },
			{ key: 'ArrowLeft', run: step('left') },
			{ key: 'ArrowRight', run: step('right') },
			{
				key: 'Escape',
				// Vim drops back to normal mode on the cell; otherwise Esc
				// leaves the table.
				run: (cell) => {
					const t = edit?.cell === cell && tableAt(edit.main.state, edit.ref.from);
					if (!edit || !t) return false;
					const main = edit.main;
					const vim = main.state.facet(tableVim);
					if (vim && vim.mode(main) !== 'off') {
						vim.exitInsert(main);
						main.focus();
					} else {
						leaveTable(main, t, true);
					}
					return true;
				}
			},
			// History lives in the main editor, which holds every cell edit.
			{ key: 'Mod-z', run: onMain(undo), preventDefault: true },
			{ key: 'Mod-y', run: onMain(redo), preventDefault: true },
			{ key: 'Mod-Shift-z', run: onMain(redo), preventDefault: true },
			{ key: 'Mod-b', run: toggleWrap('**') },
			{ key: 'Mod-i', run: toggleWrap('*') },
			{ key: 'Mod-Shift-x', run: toggleWrap('~~') },
			{ key: 'Mod-`', run: toggleWrap('`') }
		])
	),
	keymap.of(defaultKeymap)
];

// Up and Down from the main editor step into a table instead of over it.
function enterTable(down: boolean) {
	return (view: EditorView): boolean => {
		const sel = view.state.selection.main;
		if (!sel.empty || isPreviewMode()) return false;
		const next = view.moveVertically(sel, down).head;
		const raw = view.state.field(rawTableField);
		const t = findTableRanges(view.state).find((t) =>
			down ? sel.head < t.from && next >= t.from : sel.head > t.to && next <= t.to
		);
		if (!t || t.from === raw) return false;
		gotoCell(view, t, down ? 0 : displayRows(view, t).at(-1)!, 0);
		return true;
	};
}

const enterKeys = Prec.high(
	keymap.of([
		{ key: 'ArrowDown', run: enterTable(true) },
		{ key: 'ArrowUp', run: enterTable(false) }
	])
);

// Vim normal mode moves through the rendered table a row at a time. Vim's
// own j/k treat the widget like folded text and jump past the whole table,
// so these run before vim's key handler.
const VIM_ROW_KEYS: Record<string, boolean> = { j: true, ArrowDown: true, k: false, ArrowUp: false };
const vimRowKeys = Prec.highest(
	EditorView.domEventHandlers({
		keydown(e, view) {
			const down = VIM_ROW_KEYS[e.key];
			if (down === undefined || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
			if (view.state.facet(tableVim)?.mode(view) !== 'normal') return false;
			const sel = view.state.selection.main;
			const c = sel.empty && !isPreviewMode() ? cellAt(view.state, sel.head) : null;
			if (c && view.state.field(rawTableField) !== c.table.from) {
				const rows = displayRows(view, c.table);
				const next = Math.max(0, rows.indexOf(c.row)) + (down ? 1 : -1);
				if (next < 0 || next >= rows.length) leaveTable(view, c.table, down);
				else gotoCell(view, c.table, rows[next], c.col);
			} else if (!enterTable(down)(view)) {
				return false;
			}
			e.preventDefault();
			return true;
		}
	})
);

const cellSync = ViewPlugin.define((view) => {
	queueMicrotask(() => syncCell(view));
	return {
		update(u) {
			if (edit?.main === view && u.docChanged) {
				edit.ref.from = u.changes.mapPos(edit.ref.from, -1);
				edit.ref.to = u.changes.mapPos(edit.ref.to, 1);
			}
			if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged || u.transactions.some((tr) => tr.effects.length))
				queueMicrotask(() => {
					if (view.dom.isConnected) syncCell(view);
				});
		},
		destroy() {
			if (edit?.main === view) closeCell();
		}
	};
});

// ---- Table commands ----

const metaText = (meta: TableMeta) => {
	const line = metaLine(meta);
	return line ? line + '\n' : '';
};

/**
 * Replaces a table with a model's markdown, cursor at the end of a cell.
 * `meta` rewrites the settings line in the same change.
 */
function rewriteTable(main: EditorView, t: TableRange, m: TableModel, row: number, col: number, meta?: TableMeta) {
	const { text, cellPos } = writeTable(m);
	const head = meta ? metaText(meta) : '';
	const from = meta ? t.from : t.start;
	const r = Math.max(0, Math.min(row, m.rows.length - 1));
	const c = Math.max(0, Math.min(col, m.rows[0].length - 1));
	main.dispatch({
		changes: { from, to: t.to, insert: head + text },
		selection: { anchor: from + head.length + cellPos(r, c) + m.rows[r][c].length },
		scrollIntoView: true
	});
}

/** Writes a table's settings line, dropping it when nothing is set. */
function setMeta(view: EditorView, t: TableRange, meta: TableMeta) {
	const insert = metaText(meta);
	if (view.state.sliceDoc(t.from, t.start) !== insert) view.dispatch({ changes: { from: t.from, to: t.start, insert } });
}

const TYPES: { type: ColType; label: string; icon: string }[] = [
	{ type: 'text', label: 'Text', icon: 'notes' },
	{ type: 'date', label: 'Date', icon: 'calendar_today' },
	{ type: 'deadline', label: 'Deadline', icon: 'event_upcoming' },
	{ type: 'status', label: 'Status', icon: 'radio_button_checked' },
	{ type: 'number', label: 'Number', icon: 'tag' }
];
const RANGE_ITEMS: { range: DateRange; label: string }[] = [
	{ range: 'week', label: 'Next 7 days' },
	{ range: 'month', label: 'Next 30 days' },
	{ range: 'upcoming', label: 'Upcoming' },
	{ range: 'overdue', label: 'Overdue' }
];

/** Shows a menu of items at a screen point; CodeEditor provides it. */
export const tableMenu = Facet.define<
	(x: number, y: number, items: ContextMenuItem[]) => void,
	((x: number, y: number, items: ContextMenuItem[]) => void) | null
>({ combine: (v) => v[0] ?? null });

/** Sort, type and filter for one column, from its header button. */
function openColumnMenu(view: EditorView, t: TableRange, col: number, x: number, y: number) {
	const show = view.state.facet(tableMenu);
	if (!show) return;
	const meta: TableMeta = t.meta ?? { v: 1 };
	const type = colType(meta, col);
	const key = String(col);
	const filter = meta.filter?.[key] ?? {};
	const values = readTable(view.state, t).rows.slice(1).map((r) => r[col] ?? '');
	// The table may have moved while the menu was open.
	const apply = (next: TableMeta) => () => {
		const now = findTableRanges(view.state).find((r) => r.start === t.start);
		if (now) setMeta(view, now, next);
	};
	const withFilter = (f: ColFilter): TableMeta => {
		const all = { ...meta.filter };
		if (Object.keys(f).length) all[key] = f;
		else delete all[key];
		return { ...meta, filter: all };
	};
	const sorted = meta.sort?.col === col ? meta.sort.dir : 0;
	const items: ContextMenuItem[] = [
		{ label: 'Sort ascending', icon: 'arrow_upward', current: sorted > 0, action: apply({ ...meta, sort: { col, dir: 1 } }) },
		{ label: 'Sort descending', icon: 'arrow_downward', current: sorted < 0, action: apply({ ...meta, sort: { col, dir: -1 } }) },
		...(sorted ? [{ label: 'Clear sort', icon: 'close', action: apply({ ...meta, sort: undefined }) }] : []),
		...TYPES.map((o, i) => ({
			label: o.label,
			icon: o.icon,
			divider: i === 0,
			current: type === o.type,
			action: () => {
				if (o.type === type) return;
				const cols = { ...meta.cols };
				if (o.type === 'text') delete cols[key];
				else cols[key] = o.type === 'status' ? { type: o.type, options: statusOptions(null, col, values) } : { type: o.type };
				const all = { ...meta.filter };
				delete all[key];
				apply({ ...meta, cols, filter: all })();
			}
		}))
	];
	const filters: ContextMenuItem[] = [];
	if (type === 'status') {
		const options = statusOptions(meta, col, values);
		for (const v of options) {
			const hidden = !!filter.hide?.includes(v);
			const hide = hidden ? filter.hide!.filter((h) => h !== v) : [...(filter.hide ?? []), v];
			filters.push({
				label: `${hidden ? 'Show' : 'Hide'} ${v}`,
				icon: hidden ? 'visibility' : 'visibility_off',
				color: statusColor(options, v),
				action: apply(withFilter({ ...filter, hide: hide.length ? hide : undefined }))
			});
		}
	} else if (type === 'date' || type === 'deadline') {
		for (const o of RANGE_ITEMS) {
			filters.push({
				label: o.label,
				icon: 'date_range',
				current: filter.date === o.range,
				action: apply(withFilter({ ...filter, date: filter.date === o.range ? undefined : o.range }))
			});
		}
	}
	filters.push({
		label: filter.filled ? 'Show empty rows' : 'Hide empty rows',
		icon: filter.filled ? 'visibility' : 'visibility_off',
		action: apply(withFilter({ ...filter, filled: filter.filled ? undefined : true }))
	});
	filters[0].divider = true;
	show(x, y, [...items, ...filters]);
}

type TableOp = (m: TableModel, row: number, col: number) => [row: number, col: number] | null;

// `shift` moves the column settings when a column is added or removed.
function tableOp(op: TableOp, shift?: (meta: TableMeta, col: number) => TableMeta) {
	return (view: EditorView): boolean => {
		const ref = cellAt(view.state, view.state.selection.main.head);
		if (!ref) return false;
		const m = readTable(view.state, ref.table);
		const at = op(m, ref.row, ref.col);
		const meta = shift && ref.table.meta ? shift(ref.table.meta, ref.col) : undefined;
		if (at) rewriteTable(view, ref.table, m, at[0], at[1], meta);
		view.focus();
		return true;
	};
}

// Sorting is a view: it sets the table's sort, the rows stay in file order.
function sortBy(dir: 1 | -1) {
	return (view: EditorView): boolean => {
		const ref = cellAt(view.state, view.state.selection.main.head);
		if (!ref) return false;
		const width = readTable(view.state, ref.table).rows[0].length;
		if (ref.col < width) setMeta(view, ref.table, { ...(ref.table.meta ?? { v: 1 }), sort: { col: ref.col, dir } });
		view.focus();
		return true;
	};
}

const blankRow = (m: TableModel) => m.rows[0].map(() => '');
const align = (a: Align): TableOp => (m, row, col) => ((m.aligns[col] = a), [row, col]);

/** Table edits for the palette, keyed like CodeEditor's COMMANDS. */
export const tableCommands: Record<string, (view: EditorView) => boolean> = {
	tableRowAbove: tableOp((m, row, col) => {
		const at = Math.max(1, row);
		m.rows.splice(at, 0, blankRow(m));
		return [at, col];
	}),
	tableRowBelow: tableOp((m, row, col) => (m.rows.splice(row + 1, 0, blankRow(m)), [row + 1, col])),
	tableDeleteRow: tableOp((m, row, col) =>
		row === 0 ? null : (m.rows.splice(row, 1), [Math.min(row, m.rows.length - 1), col])
	),
	tableColLeft: tableOp(
		(m, row, col) => {
			for (const r of m.rows) r.splice(col, 0, '');
			m.aligns.splice(col, 0, null);
			return [row, col];
		},
		(meta, col) => shiftCols(meta, col, 1)
	),
	tableColRight: tableOp(
		(m, row, col) => {
			for (const r of m.rows) r.splice(col + 1, 0, '');
			m.aligns.splice(col + 1, 0, null);
			return [row, col + 1];
		},
		(meta, col) => shiftCols(meta, col + 1, 1)
	),
	tableDeleteCol: tableOp(
		(m, row, col) => {
			if (m.rows[0].length < 2) return null;
			for (const r of m.rows) r.splice(col, 1);
			m.aligns.splice(col, 1);
			return [row, Math.min(col, m.rows[0].length - 1)];
		},
		(meta, col) => shiftCols(meta, col, -1)
	),
	tableAlignLeft: tableOp(align('left')),
	tableAlignCenter: tableOp(align('center')),
	tableAlignRight: tableOp(align('right')),
	tableSortAsc: sortBy(1),
	tableSortDesc: sortBy(-1),
	tableSource: (view) => {
		const t = tableAt(view.state, view.state.selection.main.head);
		if (!t) return false;
		view.dispatch({ effects: rawTableEffect.of(t.from) });
		view.focus();
		return true;
	}
};

// ---- Decorations ----

// Toggles raw markdown for the table starting at the given position.
const rawTableEffect = StateEffect.define<number>();

// The table shown as raw lines, by start; cleared once the cursor leaves it.
const rawTableField = StateField.define<number | null>({
	create: () => null,
	update(raw, tr) {
		if (raw !== null && tr.docChanged) raw = tr.changes.mapPos(raw);
		for (const e of tr.effects) if (e.is(rawTableEffect)) raw = raw === e.value ? null : e.value;
		if (raw === null) return null;
		const t = tableAt(tr.state, tr.state.selection.main.head);
		return t?.from === raw ? raw : null;
	}
});

const sourceLine = Decoration.line({ class: 'cm-table-source' });
const REF_CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

// The note's `[ref]: url` definitions (any depth, quote and indent prefixes
// dropped), appended to each table's render so reference links in cells
// resolve like they do in the full note. Frontmatter and display math are
// not markdown to the renderer, so definitions there don't count.
const linkReferences = perDoc((state: EditorState): string => {
	const fm = fmEnd(state);
	const math = findMathBlockRanges(state);
	const refs: string[] = [];
	syntaxTree(state).iterate({
		enter: (n) => {
			if (n.name === 'LinkReference') {
				if (n.from >= fm && !math.some((r) => n.from < r.to && r.from < n.to)) {
					refs.push(state.doc.sliceString(n.from, n.to).replace(/^[ \t]*(?:>[ \t]?)*/gm, ''));
				}
				return false;
			}
			return REF_CONTAINERS.has(n.name);
		}
	});
	return refs.join('\n');
});

function buildTableDecorations(state: EditorState): DecorationSet {
	const tables = findTableRanges(state);
	if (!tables.length) {
		trimCache(0);
		return Decoration.none;
	}
	const noteDir = state.field(noteDirField, false) ?? null;
	const refs = linkReferences(state);
	const ranges: Range<Decoration>[] = [];
	for (const t of tables) {
		const first = state.doc.lineAt(t.from).number;
		const last = state.doc.lineAt(t.to).number;
		const widget = new TableWidget(t.source, refs, noteDir, t.meta, keepRow(state, t), () =>
			readTable(state, t).rows.slice(1)
		);
		// A cell edit keeps the table's shape (cellInputFilter), so the table
		// being typed in stays a widget without rendering it.
		const raw = state.field(rawTableField) === t.from && !isPreviewMode();
		if (raw || ((!echoing || widget.cached) && widget.html === '')) {
			for (let n = first; n <= last; n++) ranges.push(sourceLine.range(state.doc.line(n).from));
		} else {
			ranges.push(Decoration.replace({ widget, block: true }).range(t.from, t.to));
		}
	}
	trimCache(tables.length);
	return Decoration.set(ranges, true);
}

export const tableBlockField = StateField.define<DecorationSet>({
	create: (state) => buildTableDecorations(state),
	update(deco, tr) {
		if (
			tr.docChanged ||
			tr.reconfigured ||
			syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
			tr.state.field(rawTableField) !== tr.startState.field(rawTableField) ||
			tr.effects.some((e) => e.is(previewModeEffect) || e.is(noteDirEffect) || e.is(rendererReady)) ||
			(tr.selection && keepKey(tr.state) !== keepKey(tr.startState))
		) {
			return buildTableDecorations(tr.state);
		}
		return deco;
	},
	provide: (f) => [rawTableField, EditorView.decorations.from(f), cellSync, enterKeys, vimRowKeys]
});
