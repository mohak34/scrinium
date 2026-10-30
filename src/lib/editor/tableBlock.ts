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
	showTooltip,
	type DecorationSet
} from '@codemirror/view';
import { defaultKeymap, redo, undo } from '@codemirror/commands';
import {
	autocompletion,
	startCompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult
} from '@codemirror/autocomplete';
import {
	followWikilink,
	isPreviewMode,
	noteDirEffect,
	noteDirField,
	openUrl,
	previewModeEffect,
	setPreviewMode,
	tagCtxField,
	wikiCtxField
} from './livePreview';
import { wikiCompletionSource } from './wikiComplete';
import { tagCompletionSource } from './tagComplete';
import { findWikilinksInText } from './wikilinks';
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
	// Toolbar, header, rows and the New row button, so a fresh widget
	// doesn't flap the viewport before it is measured (see BlockMathWidget).
	get estimatedHeight(): number {
		return 16 + 32 + (this.order.length + 1) * 33 + 30;
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
		if (html === null) {
			div.textContent = this.source;
			void loadRenderer().then(() => {
				if (div.isConnected) view.dispatch({ effects: rendererReady.of(null) });
			});
			return;
		}
		div.innerHTML = html;
		orders.set(div, this.order);
		if (html) this.dress(div, view);
	}
	/** Toolbar, header icons, typed cells, then column widths. */
	dress(div: HTMLElement, view: EditorView) {
		const table = div.querySelector('table');
		if (!table) return;
		const meta = this.meta;
		const width = table.rows[0]?.cells.length ?? 0;
		const types = Array.from({ length: width }, (_, col) => colType(meta, col));
		// Every cell's content goes in one box, so an open cell editor can
		// cover it and a one-line cell can clip it.
		for (const row of table.rows) {
			for (const cell of row.cells) {
				const box = document.createElement('div');
				box.className = 'cm-cell-v';
				box.append(...cell.childNodes);
				cell.append(box);
			}
		}
		Array.from(table.rows[0]?.cells ?? []).forEach((th, col) => {
			const sorted = meta?.sort?.col === col ? meta.sort.dir : 0;
			const icon = document.createElement('span');
			icon.className = 'cm-th-icon material-symbols-outlined';
			icon.textContent = sorted > 0 ? 'arrow_upward' : sorted < 0 ? 'arrow_downward' : TYPE_ICON[types[col]];
			th.firstElementChild?.prepend(icon);
			th.classList.toggle('cm-th-sorted', !!sorted);
			th.classList.toggle('cm-th-filtered', !!meta?.filter?.[col]);
			th.title = 'Column options';
			const handle = document.createElement('span');
			handle.className = 'cm-th-rz';
			handle.title = 'Drag to resize, double-click to fit';
			th.append(handle);
		});
		const body = types.some((t) => t !== 'text') ? this.body() : [];
		const today = localDay();
		const soon = localDay(7);
		types.forEach((type, col) => {
			if (type === 'text') return;
			table.rows[0].cells[col].classList.add(`cm-col-${type}`);
			const options = type === 'status' ? statusOptions(meta, col, body.map((r) => r[col] ?? '')) : [];
			this.order.forEach((src, i) => {
				const td = table.rows[i + 1]?.cells[col];
				const v = body[src]?.[col] ?? '';
				const box = td?.firstElementChild as HTMLElement | null;
				if (!td || !box) return;
				td.classList.add(`cm-col-${type}`);
				if (!v) return;
				if (type === 'status') {
					td.style.setProperty('--status', statusColor(options, v));
				} else if (type === 'number') {
					if (/^-?\d+(\.\d+)?$/.test(v)) box.textContent = groupDigits(v);
					else markBad(td, 'Not a number');
				} else if (validDate(v)) {
					box.textContent = friendlyDate(v);
					td.title = v;
					if (type === 'deadline') td.classList.add(v < today ? 'cm-cell-over' : v <= soon ? 'cm-cell-near' : 'cm-cell-ok');
				} else {
					markBad(td, 'Not a date, use YYYY-MM-DD');
				}
			});
		});
		// The kept row once the filter would hide it.
		const out = this.keep !== null && !tableView(this.body(), meta, null).includes(this.keep);
		if (out) {
			const tr = table.rows[this.order.indexOf(this.keep) + 1];
			tr?.classList.add('cm-row-out');
			tr?.setAttribute('title', 'Hidden by the filter once you leave this row');
		}
		const scroll = document.createElement('div');
		scroll.className = 'cm-table-scroll';
		table.replaceWith(scroll);
		scroll.append(table);
		const bar = document.createElement('div');
		bar.className = 'cm-table-bar';
		const filters = Object.keys(meta?.filter ?? {}).length;
		const total = this.source.split('\n').length - 2;
		const shown = this.order.length - (out ? 1 : 0);
		bar.innerHTML =
			`<button data-act="sort"${meta?.sort ? ' class="on"' : ''}><span class="material-symbols-outlined">swap_vert</span>Sort</button>` +
			`<button data-act="filter"${filters ? ' class="on"' : ''}><span class="material-symbols-outlined">filter_list</span>Filter${filters ? ` ${filters}` : ''}</button>` +
			`<span class="cm-table-count">${shown === total ? plural(total, 'row') : `${shown} of ${plural(total, 'row')}`}</span>` +
			`<button data-act="source" class="cm-table-md"><span class="material-symbols-outlined">code</span>Markdown</button>`;
		const add = document.createElement('button');
		add.className = 'cm-table-addrow';
		add.dataset.act = 'row';
		add.innerHTML = '<span class="material-symbols-outlined">add</span>New row';
		div.prepend(bar);
		div.append(add);
		layoutColumns(div, table, types, view);
	}
	destroy(dom: HTMLElement) {
		if (edit?.host === dom) closeCell();
	}
	ignoreEvent() {
		return true;
	}
}

const TYPE_ICON: Record<ColType, string> = {
	text: 'notes',
	date: 'calendar_today',
	deadline: 'event_upcoming',
	status: 'radio_button_checked',
	number: 'tag'
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const groupDigits = (v: string) => v.replace(/^(-?\d+)/, (i) => i.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// isDate only checks the shape; this also rejects 2026-02-30.
function validDate(v: string): boolean {
	if (!isDate(v)) return false;
	const [y, m, d] = v.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `Nov 2`, with the year when it is not this year. */
function friendlyDate(v: string): string {
	const [y, m, d] = v.split('-').map(Number);
	return `${MONTHS[m - 1]} ${d}${y === new Date().getFullYear() ? '' : `, ${y}`}`;
}

function markBad(td: HTMLElement, why: string) {
	td.classList.add('cm-cell-bad');
	td.title = why;
}

// ---- Column widths ----

// Widths are measured once from the rendered cells, then the table is laid
// out fixed: a click, an open cell editor or a repaint never resizes a
// column. Measured widths are kept per table DOM while its column types
// and shown rows stay the same (and per source, for a widget drawn
// again), so leaving an edited cell keeps the columns where they were; a
// sort, filter or type change measures again.
const MIN_COL = 64;
const MAX_TEXT_COL = 320;
const MAX_COL = 220;
// Text columns give up width down to this before the table scrolls.
const SHRINK_TO = 120;
// The filler column's width when the table scrolls.
const FILL_COL = 36;
const domWidths = new WeakMap<HTMLElement, { shape: string; widths: number[] }>();
const widthCache = new Map<string, number[]>();

function measureColumns(table: HTMLTableElement, types: ColType[]): number[] {
	table.classList.add('cm-table-measure');
	const widths = types.map((type, i) =>
		Math.ceil(
			Math.min(Math.max(table.rows[0].cells[i].getBoundingClientRect().width + 1, MIN_COL), type === 'text' ? MAX_TEXT_COL : MAX_COL)
		)
	);
	table.classList.remove('cm-table-measure');
	return widths;
}

/**
 * Widths fitted to the note: columns keep their natural or `fixed` width,
 * and text columns that aren't fixed shrink before the table scrolls.
 */
function fitColumns(natural: number[], types: ColType[], fixed: boolean[], room: number) {
	const w = [...natural];
	const sum = w.reduce((a, b) => a + b, 0);
	if (sum > room) {
		const give = w.map((x, i) => (types[i] === 'text' && !fixed[i] ? Math.max(0, x - SHRINK_TO) : 0));
		const spare = give.reduce((a, b) => a + b, 0);
		const cut = Math.min(sum - room, spare);
		if (spare) w.forEach((x, i) => (w[i] = x - Math.floor((cut * give[i]) / spare)));
	}
	return w;
}

function layoutColumns(div: HTMLElement, table: HTMLTableElement, types: ColType[], view: EditorView) {
	const widget = widgets.get(div);
	const key = `${types.join()}\n${widget?.source ?? ''}`;
	const shape = `${types.join()}\n${widget?.order.join() ?? ''}`;
	const set = types.map((_, i) => widget?.meta?.cols?.[i]?.width);
	const apply = (natural: number[], room: number) => {
		const w = fitColumns(
			natural.map((x, i) => set[i] ?? x),
			types,
			set.map((x) => x !== undefined),
			room
		);
		const sum = w.reduce((a, b) => a + b, 0);
		const wide = sum + FILL_COL > room + 1;
		// The table ends in an empty filler column holding the new-column
		// button. It takes whatever the note width gives a table that fits,
		// so no real cell stretches.
		const group = document.createElement('colgroup');
		[...w, FILL_COL].forEach((x, i) => {
			const col = document.createElement('col');
			if (wide || i < w.length) col.style.width = `${x}px`;
			group.append(col);
		});
		table.querySelector('colgroup')?.remove();
		table.prepend(group);
		table.querySelectorAll('.cm-cell-fill').forEach((c) => c.remove());
		for (const tr of table.rows) {
			const head = tr.parentElement?.tagName === 'THEAD';
			const c = document.createElement(head ? 'th' : 'td');
			c.className = 'cm-cell-fill';
			if (head)
				c.innerHTML =
					'<button data-act="col" title="New column"><span class="material-symbols-outlined">add</span></button>';
			tr.append(c);
		}
		table.style.width = wide ? `${sum + FILL_COL}px` : '100%';
		div.classList.toggle('cm-table-wide', wide);
	};
	const measure = () => {
		if (!div.contains(table)) return;
		const kept = domWidths.get(div);
		const natural =
			kept?.shape === shape ? kept.widths : (widthCache.get(key) ?? measureColumns(table, types));
		domWidths.set(div, { shape, widths: natural });
		widthCache.delete(key);
		widthCache.set(key, natural);
		while (widthCache.size > CACHE_SPARE) widthCache.delete(widthCache.keys().next().value!);
		apply(natural, div.clientWidth);
	};
	if (div.isConnected) return measure();
	// A fresh DOM is not in the page yet: lay it out from the last
	// measurement of the same table, then fit it once it is.
	const known = widthCache.get(key);
	if (known) apply(known, view.contentDOM.clientWidth - 64);
	view.requestMeasure({ read: measure });
}

/**
 * Drags a column's right edge from a press on its handle. The table is
 * held at its drawn widths while dragging; the width is written to the
 * settings line on release. A double-click sets the measured width.
 */
function resizeColumn(e: MouseEvent, view: EditorView, div: HTMLElement, t: TableRange, col: number) {
	const table = div.querySelector('table');
	const cols = table?.querySelectorAll('col');
	const handle = e.target as HTMLElement;
	if (!table || !cols?.[col]) return;
	const save = (width: number) => {
		const meta: TableMeta = t.meta ?? { v: 1 };
		const key = String(col);
		const cur = meta.cols?.[key] ?? { type: 'text' };
		metaSetter(view, t)({ ...meta, cols: { ...meta.cols, [key]: { ...cur, width } } })();
	};
	if (e.detail === 2) {
		const fit = domWidths.get(div)?.widths[col];
		if (fit) save(fit);
		return;
	}
	const start = Array.from(table.rows[0].querySelectorAll(':scope > :not(.cm-cell-fill)'), (c) => c.getBoundingClientRect().width);
	start.forEach((w, i) => cols[i] && (cols[i].style.width = `${w}px`));
	const rest = start.reduce((a, b) => a + b, 0) - start[col];
	const x0 = e.clientX;
	let width = Math.round(start[col]);
	const move = (ev: MouseEvent) => {
		width = Math.max(MIN_COL, Math.round(start[col] + ev.clientX - x0));
		cols[col].style.width = `${width}px`;
		// The filler, while there, keeps a narrowed table at the note width.
		table.style.width = `${Math.max(rest + width + FILL_COL, div.clientWidth)}px`;
		div.classList.toggle('cm-table-wide', rest + width + FILL_COL > div.clientWidth + 1);
	};
	const up = () => {
		window.removeEventListener('mousemove', move);
		window.removeEventListener('mouseup', up);
		document.documentElement.classList.remove('cm-col-resizing');
		handle.classList.remove('cm-th-rz-drag');
		if (width !== Math.round(start[col])) save(width);
	};
	window.addEventListener('mousemove', move);
	window.addEventListener('mouseup', up);
	document.documentElement.classList.add('cm-col-resizing');
	handle.classList.add('cm-th-rz-drag');
}

function filterText(f: ColFilter): string {
	const parts: string[] = [];
	if (f.hide?.length) parts.push(`hides ${f.hide.join(', ')}`);
	if (f.date) parts.push(DATE_RANGE_LABEL[f.date]);
	if (f.filled) parts.push('not empty');
	if (f.text) parts.push(`contains "${f.text}"`);
	return parts.join(', ');
}

/**
 * Where the next cell editor opens: at a press on the rendered table, or
 * 'open' for an editor opened by a command (New row, Rename).
 */
let pendingClick: { x: number; y: number } | 'open' | null = null;

// The URL markdown-it rendered for a link. It percent-encodes the href and
// resolveAssetUrl encodes each path segment again, so a relative one is
// decoded fully first.
function linkHref(a: Element): string {
	let href = a.getAttribute('href') ?? '';
	if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/')) {
		try {
			href = decodeURIComponent(href);
		} catch {}
	}
	return href;
}

function onTableMouseDown(e: MouseEvent, view: EditorView, div: HTMLElement) {
	if (e.button !== 0) return;
	const target = e.target as Element;
	// The open cell editor handles its own presses (Ctrl+click: cellLinkClick).
	if (edit?.host === div && edit.cell.dom.contains(target)) return;
	const widget = widgets.get(div);
	const t = tableAt(view.state, view.posAtDOM(div));
	if (!widget || !t) return;
	if (e.ctrlKey || e.metaKey) {
		const wiki = target.closest<HTMLElement>('.print-wikilink');
		const link = target.closest('a');
		if (wiki || link) {
			e.preventDefault();
			if (wiki) followWikilink(view, wiki.dataset.target ?? '', wiki.dataset.heading ?? null);
			else if (link) openUrl(linkHref(link), widget.noteDir);
			return;
		}
	}
	if (target.classList.contains('cm-th-rz')) {
		e.preventDefault();
		const th = target.closest('th');
		resizeColumn(e, view, div, t, Array.from(th?.parentElement?.children ?? []).indexOf(th as Element));
		return;
	}
	const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
	if (act) {
		e.preventDefault();
		const r = target.closest('[data-act]')!.getBoundingClientRect();
		if (act === 'sort') openSortMenu(view, t, r.left, r.bottom + 4);
		else if (act === 'filter') openFilterMenu(view, t, r.left, r.bottom + 4);
		else if (act === 'source') {
			view.dispatch({ selection: { anchor: t.start }, effects: rawTableEffect.of(t.from) });
			view.focus();
		} else if (act === 'col') {
			pendingClick = 'open';
			atColumn(view, t, readTable(view.state, t).rows[0].length - 1, tableCommands.tableColRight)();
			view.focus();
		} else if (act === 'row') {
			pendingClick = 'open';
			rewriteTable(view, t, withRow(readTable(view.state, t)), Infinity, 0);
			view.focus();
		}
		return;
	}
	// A wide table scrolls itself; a press below its client box is on
	// the scrollbar, so the browser keeps it.
	if (
		target.classList.contains('cm-table-scroll') &&
		e.clientY >= target.getBoundingClientRect().top + target.clientTop + target.clientHeight
	)
		return;
	e.preventDefault();
	const cellEl = target.closest('td, th');
	if (!cellEl || cellEl.classList.contains('cm-cell-fill')) return;
	const col = Math.max(0, Array.from(cellEl.parentElement?.children ?? []).indexOf(cellEl));
	if (cellEl.tagName === 'TH' && !e.shiftKey) {
		const r = cellEl.getBoundingClientRect();
		openColumnMenu(view, t, col, r.left, r.bottom + 4);
		return;
	}
	const rows = Array.from(div.querySelectorAll('tr'));
	const row = sourceRow(div, Math.max(0, rows.indexOf(cellEl.closest('tr') as HTMLTableRowElement)));
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

// Ctrl/Cmd+click on a link in the open cell editor's raw text opens it.
const MD_LINK = /!?\[(?:\\.|[^\]\\])*\]\(\s*<?([^)\s>]+)>?[^)]*\)|https?:\/\/[^\s|)]+/g;
const cellLinkClick = EditorView.domEventHandlers({
	mousedown(e, cell) {
		if (!(e.ctrlKey || e.metaKey) || !edit || edit.cell !== cell) return false;
		const pos = cell.posAtCoords(e);
		if (pos === null) return false;
		const text = cell.state.doc.toString();
		const main = edit.main;
		const wiki = findWikilinksInText(text).find((w) => pos >= w.from && pos <= w.to);
		if (wiki) {
			e.preventDefault();
			followWikilink(main, wiki.target, wiki.heading);
			return true;
		}
		for (const m of text.matchAll(MD_LINK)) {
			if (pos < m.index || pos > m.index + m[0].length) continue;
			e.preventDefault();
			openUrl(m[1] ?? m[0], main.state.field(noteDirField, false) ?? null);
			return true;
		}
		return false;
	}
});

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
			td.classList.add('cm-cell-editing');
			td.append(mine.cell.dom);
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
	// The editor lies over the cell's rendered content, which keeps the
	// row's height.
	freshTd.classList.add('cm-cell-editing');
	const cell = new EditorView({
		parent: freshTd,
		state: EditorState.create({
			doc: text,
			selection: local,
			extensions: [
				cellExtensions,
				// The note list and tags for `[[` and `#` completion, as the note has them.
				wikiCtxField.init(() => view.state.field(wikiCtxField)),
				tagCtxField.init(() => view.state.field(tagCtxField)),
				ref.row > 0 && /^(date|deadline)$/.test(colType(ref.table.meta, ref.col)) ? datePicker : []
			]
		})
	});
	edit = { main: view, cell, host: freshHost, ref, refocus: false, opened: text };
	if (click && click !== 'open') {
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
	if (colType(t.meta, ref.col) === 'status')
		return statusOptions(t.meta, ref.col, column.filter((_, i) => i > 0 && (own || i !== ref.row)));
	const filled = column.slice(1).filter(Boolean);
	if (new Set(filled).size === filled.length) return [];
	const others = column.filter((v, i) => v && i > 0 && (own || i !== ref.row));
	return [...new Set(others)].sort((a, b) => a.localeCompare(b));
}

// Status colors of the open cell's choices, for the dots in its list.
let choiceColors = new Map<string, string>();

// A cell lists every choice until it is edited, to show what a filled
// cell can change to; typing filters them. A status cell is a picker:
// colored choices, plus one that adds what was typed.
function cellCompletions(ctx: CompletionContext): CompletionResult | null {
	const meta = edit && tableAt(edit.main.state, edit.ref.from)?.meta;
	const type = edit && edit.ref.row > 0 ? colType(meta ?? null, edit.ref.col) : 'text';
	if (type === 'date' || type === 'deadline') return null;
	const untouched = ctx.state.doc.toString() === edit?.opened;
	const choices = columnChoices(untouched);
	const typed = ctx.state.doc.toString().trim();
	const adding = type === 'status' && !untouched && !!typed && !choices.includes(typed);
	if (type === 'status') {
		const all = adding ? [...choices, typed] : choices;
		choiceColors = new Map(all.map((c) => [c, statusColor(all, c)]));
	} else choiceColors = new Map();
	if (!choices.length && !adding) return null;
	const options: Completion[] = choices.map((label) => ({ label }));
	if (adding) options.push({ label: typed, displayLabel: `Add "${typed}"`, boost: -99 });
	return { from: 0, to: ctx.state.doc.length, options, filter: !untouched };
}

const choiceDot = {
	position: 20,
	render: (c: Completion) => {
		const color = choiceColors.get(c.label);
		if (!color) return null;
		const dot = document.createElement('span');
		dot.className = 'cm-choice-dot';
		dot.style.background = color;
		return dot;
	}
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const dayKey = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The calendar under an open date cell. A click on a day writes it into
 * the cell like typing; typing a date moves the calendar to it.
 */
const datePicker = showTooltip.of({
	pos: 0,
	above: false,
	create(cell) {
		const dom = document.createElement('div');
		dom.className = 'cm-date-pop';
		// First of the month on screen; null follows the cell's date.
		let month: Date | null = null;
		const draw = () => {
			const v = cell.state.doc.toString().trim();
			const picked = validDate(v) ? v : null;
			const today = localDay();
			const at = picked ?? today;
			const m = (month ??= new Date(Number(at.slice(0, 4)), Number(at.slice(5, 7)) - 1, 1));
			const lead = (m.getDay() + 6) % 7;
			const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
			let grid = WEEKDAYS.map((d) => `<span class="cm-date-wd">${d}</span>`).join('');
			for (let i = 0; i < Math.ceil((lead + days) / 7) * 7; i++) {
				const d = new Date(m.getFullYear(), m.getMonth(), 1 - lead + i);
				const k = dayKey(d);
				const cls = [
					d.getMonth() !== m.getMonth() && 'other',
					k === today && 'today',
					k === picked && 'on'
				].filter(Boolean);
				grid += `<button data-day="${k}"${cls.length ? ` class="${cls.join(' ')}"` : ''}>${d.getDate()}</button>`;
			}
			const hint = picked
				? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${picked}T00:00`).getDay()]}, ${friendlyDate(picked)}`
				: v
					? 'Not a date, use YYYY-MM-DD'
					: 'Type YYYY-MM-DD';
			dom.innerHTML =
				`<div class="cm-date-head"><button data-step="-1" title="Previous month"><span class="material-symbols-outlined">chevron_left</span></button>` +
				`<span>${MONTH_NAMES[m.getMonth()]} ${m.getFullYear()}</span>` +
				`<button data-step="1" title="Next month"><span class="material-symbols-outlined">chevron_right</span></button></div>` +
				`<div class="cm-date-grid">${grid}</div>` +
				`<div class="cm-date-foot"><span class="cm-date-hint${picked || !v ? '' : ' bad'}">${hint}</span>` +
				`<button data-day="${today}">Today</button>${v ? '<button data-day="">Clear</button>' : ''}</div>`;
		};
		// Presses never take focus from the cell.
		dom.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const b = (e.target as Element).closest<HTMLElement>('button');
			if (!b) return;
			if (b.dataset.step && month) {
				month = new Date(month.getFullYear(), month.getMonth() + Number(b.dataset.step), 1);
				draw();
			} else if (b.dataset.day !== undefined) {
				const v = b.dataset.day;
				cell.dispatch({
					changes: { from: 0, to: cell.state.doc.length, insert: v },
					selection: { anchor: v.length },
					userEvent: 'input.pick'
				});
			}
		});
		draw();
		return {
			dom,
			update(u) {
				if (!u.docChanged) return;
				month = null;
				draw();
			}
		};
	}
});

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
	cellLinkClick,
	autocompletion({
		override: [cellCompletions, wikiCompletionSource, tagCompletionSource],
		icons: false,
		addToOptions: [choiceDot]
	}),
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

/** Sets settings on a table that may have moved while a menu was open. */
const metaSetter = (view: EditorView, t: TableRange) => (next: TableMeta) => () => {
	const now = findTableRanges(view.state).find((r) => r.start === t.start);
	if (now) setMeta(view, now, next);
};

// Header names for menus, numbered when blank or repeated (menu labels
// must be unique).
function columnNames(view: EditorView, t: TableRange): string[] {
	const head = readTable(view.state, t).rows[0];
	return head.map((h, i) => {
		const name = h.trim() || `Column ${i + 1}`;
		return head.findIndex((o, j) => (o.trim() || `Column ${j + 1}`) === name) === i ? name : `${name} (${i + 1})`;
	});
}

// A menu opened from another menu's item waits for that one to close.
const later = (open: () => void) => () => queueMicrotask(open);

/**
 * A one-line input at a screen point, for menu items that need text.
 * Enter or leaving it keeps the text, Esc drops it.
 */
function askText(view: EditorView, x: number, y: number, value: string, done: (text: string) => void) {
	const box = document.createElement('div');
	box.className = 'cm-table-ask';
	const input = document.createElement('input');
	input.placeholder = 'Contains...';
	input.spellcheck = false;
	input.value = value;
	box.append(input);
	view.dom.append(box);
	box.style.left = `${Math.max(8, Math.min(x, innerWidth - box.offsetWidth - 8))}px`;
	box.style.top = `${Math.max(8, Math.min(y, innerHeight - box.offsetHeight - 8))}px`;
	let open = true;
	const close = (keep: boolean) => {
		if (!open) return;
		open = false;
		box.remove();
		if (keep) done(input.value.trim());
		view.focus();
	};
	input.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if (e.key === 'Enter' || e.key === 'Escape') {
			e.preventDefault();
			close(e.key === 'Enter');
		}
	});
	input.addEventListener('blur', () => close(true));
	input.focus();
	input.select();
}

/** Filter choices for one column; x and y place the Contains input. */
function filterItems(view: EditorView, t: TableRange, col: number, x: number, y: number): ContextMenuItem[] {
	const meta: TableMeta = t.meta ?? { v: 1 };
	const type = colType(meta, col);
	const key = String(col);
	const filter = meta.filter?.[key] ?? {};
	const apply = metaSetter(view, t);
	const withFilter = (f: ColFilter): TableMeta => {
		const all = { ...meta.filter };
		if (Object.keys(f).length) all[key] = f;
		else delete all[key];
		return { ...meta, filter: all };
	};
	const items: ContextMenuItem[] = [];
	if (type === 'status') {
		const values = readTable(view.state, t).rows.slice(1).map((r) => r[col] ?? '');
		const options = statusOptions(meta, col, values);
		for (const v of options) {
			const hidden = !!filter.hide?.includes(v);
			const hide = hidden ? filter.hide!.filter((h) => h !== v) : [...(filter.hide ?? []), v];
			items.push({
				label: `${hidden ? 'Show' : 'Hide'} ${v}`,
				icon: hidden ? 'visibility' : 'visibility_off',
				color: statusColor(options, v),
				action: apply(withFilter({ ...filter, hide: hide.length ? hide : undefined }))
			});
		}
	} else if (type === 'date' || type === 'deadline') {
		for (const o of RANGE_ITEMS) {
			items.push({
				label: o.label,
				icon: 'date_range',
				current: filter.date === o.range,
				action: apply(withFilter({ ...filter, date: filter.date === o.range ? undefined : o.range }))
			});
		}
	} else {
		items.push({
			label: filter.text ? `Contains "${filter.text}"` : 'Contains...',
			icon: 'search',
			current: !!filter.text,
			action: later(() =>
				askText(view, x, y, filter.text ?? '', (text) => apply(withFilter({ ...filter, text: text || undefined }))())
			)
		});
	}
	items.push({
		label: filter.filled ? 'Show empty rows' : 'Hide empty rows',
		icon: filter.filled ? 'visibility' : 'visibility_off',
		action: apply(withFilter({ ...filter, filled: filter.filled ? undefined : true }))
	});
	if (Object.keys(filter).length) {
		items.push({ label: 'Remove filter', icon: 'close', divider: true, action: apply(withFilter({})) });
	}
	return items;
}

/** Runs a table command with the cursor in a column's header cell. */
function atColumn(view: EditorView, t: TableRange, col: number, cmd: (view: EditorView) => boolean) {
	return () => {
		const now = findTableRanges(view.state).find((r) => r.start === t.start);
		if (!now) return;
		gotoCell(view, now, 0, col);
		cmd(view);
	};
}

/** Header menu: rename, type, sort, filter and column edits. */
function openColumnMenu(view: EditorView, t: TableRange, col: number, x: number, y: number) {
	const show = view.state.facet(tableMenu);
	if (!show) return;
	const meta: TableMeta = t.meta ?? { v: 1 };
	const type = colType(meta, col);
	const key = String(col);
	const apply = metaSetter(view, t);
	const values = readTable(view.state, t).rows.slice(1).map((r) => r[col] ?? '');
	const sorted = meta.sort?.col === col ? meta.sort.dir : 0;
	const width = readTable(view.state, t).rows[0].length;
	show(x, y, [
		{
			label: 'Rename',
			icon: 'edit',
			action: () => {
				const now = findTableRanges(view.state).find((r) => r.start === t.start);
				if (!now) return;
				pendingClick = 'open';
				gotoCell(view, now, 0, col);
				view.focus();
			}
		},
		...TYPES.map((o, i) => ({
			label: o.label,
			icon: o.icon,
			divider: i === 0,
			current: type === o.type,
			action: () => {
				if (o.type === type) return;
				const cols = { ...meta.cols };
				const width = cols[key]?.width;
				if (o.type === 'text' && !width) delete cols[key];
				else
					cols[key] = {
						type: o.type,
						...(o.type === 'status' && { options: statusOptions(null, col, values) }),
						...(width && { width })
					};
				const all = { ...meta.filter };
				delete all[key];
				apply({ ...meta, cols, filter: all })();
			}
		})),
		{ label: 'Sort ascending', icon: 'arrow_upward', divider: true, current: sorted > 0, action: apply({ ...meta, sort: { col, dir: 1 } }) },
		{ label: 'Sort descending', icon: 'arrow_downward', current: sorted < 0, action: apply({ ...meta, sort: { col, dir: -1 } }) },
		...(sorted ? [{ label: 'Clear sort', icon: 'close', action: apply({ ...meta, sort: undefined }) }] : []),
		{
			label: 'Filter',
			icon: 'filter_list',
			current: !!meta.filter?.[key],
			action: later(() => show(x, y, filterItems(view, t, col, x, y)))
		},
		{ label: 'Insert column left', icon: 'add_column_left', divider: true, action: atColumn(view, t, col, tableCommands.tableColLeft) },
		{ label: 'Insert column right', icon: 'add_column_right', action: atColumn(view, t, col, tableCommands.tableColRight) },
		...(width > 1 ? [{ label: 'Delete column', icon: 'delete', danger: true, action: atColumn(view, t, col, tableCommands.tableDeleteCol) }] : [])
	]);
}

/** Toolbar Sort: pick a column; picking it again flips, then clears. */
function openSortMenu(view: EditorView, t: TableRange, x: number, y: number) {
	const show = view.state.facet(tableMenu);
	if (!show) return;
	const meta: TableMeta = t.meta ?? { v: 1 };
	const apply = metaSetter(view, t);
	const items: ContextMenuItem[] = columnNames(view, t).map((name, col) => {
		const dir = meta.sort?.col === col ? meta.sort.dir : 0;
		return {
			label: dir ? `${name}, ${dir > 0 ? 'ascending' : 'descending'}` : name,
			icon: dir > 0 ? 'arrow_upward' : dir < 0 ? 'arrow_downward' : TYPE_ICON[colType(meta, col)],
			current: !!dir,
			action: apply({ ...meta, sort: dir < 0 ? undefined : { col, dir: dir > 0 ? -1 : 1 } })
		};
	});
	if (meta.sort) items.push({ label: 'Clear sort', icon: 'close', divider: true, action: apply({ ...meta, sort: undefined }) });
	show(x, y, items);
}

/** Toolbar Filter: a column, then its filter choices. */
function openFilterMenu(view: EditorView, t: TableRange, x: number, y: number) {
	const show = view.state.facet(tableMenu);
	if (!show) return;
	const meta: TableMeta = t.meta ?? { v: 1 };
	const items: ContextMenuItem[] = columnNames(view, t).map((name, col) => {
		const f = meta.filter?.[col];
		return {
			label: f ? `${name}: ${filterText(f)}` : name,
			icon: TYPE_ICON[colType(meta, col)],
			current: !!f,
			action: later(() => show(x, y, filterItems(view, t, col, x, y)))
		};
	});
	if (hasFilter(meta)) {
		items.push({ label: 'Clear filters', icon: 'close', divider: true, action: metaSetter(view, t)({ ...meta, filter: undefined }) });
	}
	show(x, y, items);
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
