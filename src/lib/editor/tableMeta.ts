/**
 * Table settings kept in the note: one HTML comment line right above a GFM
 * table holds its column types, sort and filters, so they travel with the
 * file. Columns are keyed by index, so renaming a header keeps its type;
 * column commands shift the keys (`shiftCols`). The editor hides the line
 * inside the table widget, the renderer drops it.
 *
 * `tableView` is the one rule for which body rows show and in what order.
 * Sort and filter never reorder the markdown itself.
 */

// A deadline is a date that turns red once past and yellow within a week.
export type ColType = 'text' | 'date' | 'deadline' | 'status' | 'number';
export type DateRange = 'overdue' | 'upcoming' | 'week' | 'month';

export interface ColumnMeta {
	type: ColType;
	// Status choices in sort order; values typed later append after these.
	options?: string[];
}

export interface ColFilter {
	// Status values left out.
	hide?: string[];
	date?: DateRange;
	// Drops rows with this column empty.
	filled?: boolean;
}

export interface TableMeta {
	v: 1;
	cols?: Record<string, ColumnMeta>;
	sort?: { col: number; dir: 1 | -1 };
	filter?: Record<string, ColFilter>;
}

const META_RE = /^<!-- scrinium-table: (\{.*\}) -->$/;
const COL_TYPES: readonly string[] = ['text', 'date', 'deadline', 'status', 'number'];
const RANGES: readonly string[] = ['overdue', 'upcoming', 'week', 'month'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | undefined =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

/** The settings on a line, null when it is not a settings comment. */
export function parseMeta(line: string): TableMeta | null {
	const m = META_RE.exec(line.trim());
	if (!m) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(m[1]);
	} catch {
		return null;
	}
	if (!isRecord(raw) || raw.v !== 1) return null;
	const meta: TableMeta = { v: 1 };
	if (isRecord(raw.cols)) {
		const cols: Record<string, ColumnMeta> = {};
		for (const [k, c] of Object.entries(raw.cols)) {
			if (!isRecord(c) || !COL_TYPES.includes(c.type as string)) continue;
			cols[k] = { type: c.type as ColType, ...(strings(c.options) && { options: strings(c.options) }) };
		}
		meta.cols = cols;
	}
	if (isRecord(raw.sort) && Number.isInteger(raw.sort.col) && (raw.sort.dir === 1 || raw.sort.dir === -1)) {
		meta.sort = { col: raw.sort.col as number, dir: raw.sort.dir };
	}
	if (isRecord(raw.filter)) {
		const filter: Record<string, ColFilter> = {};
		for (const [k, f] of Object.entries(raw.filter)) {
			if (!isRecord(f)) continue;
			const out: ColFilter = {};
			const hide = strings(f.hide);
			if (hide?.length) out.hide = hide;
			if (RANGES.includes(f.date as string)) out.date = f.date as DateRange;
			if (f.filled === true) out.filled = true;
			if (Object.keys(out).length) filter[k] = out;
		}
		meta.filter = filter;
	}
	return meta;
}

/** The comment line for settings, '' when nothing is set. */
export function metaLine(meta: TableMeta): string {
	const clean: TableMeta = { v: 1 };
	if (meta.cols && Object.keys(meta.cols).length) clean.cols = meta.cols;
	if (meta.sort) clean.sort = meta.sort;
	if (meta.filter && Object.keys(meta.filter).length) clean.filter = meta.filter;
	if (Object.keys(clean).length === 1) return '';
	// `-->` inside a value would end the comment early.
	return `<!-- scrinium-table: ${JSON.stringify(clean).replaceAll('-->', '--\\u003e')} -->`;
}

/** Settings after inserting (`delta` 1) or deleting (-1) column `at`. */
export function shiftCols(meta: TableMeta, at: number, delta: 1 | -1): TableMeta {
	const move = <T>(rec: Record<string, T> | undefined) => {
		if (!rec) return rec;
		const out: Record<string, T> = {};
		for (const [k, v] of Object.entries(rec)) {
			const i = Number(k);
			if (delta < 0 && i === at) continue;
			out[String(i >= at ? i + delta : i)] = v;
		}
		return out;
	};
	const sort =
		meta.sort && !(delta < 0 && meta.sort.col === at)
			? { ...meta.sort, col: meta.sort.col >= at ? meta.sort.col + delta : meta.sort.col }
			: undefined;
	return { v: 1, cols: move(meta.cols), sort, filter: move(meta.filter) };
}

export const colType = (meta: TableMeta | null, col: number): ColType =>
	meta?.cols?.[col]?.type ?? 'text';

/** Today as `YYYY-MM-DD` in local time, `days` ahead. */
export function localDay(days = 0): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function asNumber(v: string): number | null {
	const n = Number(v.replace(/[,$%\s]/g, ''));
	return v.trim() && Number.isFinite(n) ? n : null;
}

/** Status choices: the declared ones in order, then other values as they appear. */
export function statusOptions(meta: TableMeta | null, col: number, values: string[]): string[] {
	const out = [...(meta?.cols?.[col]?.options ?? [])];
	for (const v of values) if (v && !out.includes(v)) out.push(v);
	return out;
}

const STATUS_COLORS = ['blue', 'yellow', 'green', 'violet', 'orange', 'rose', 'sand', 'red'];
export const statusColor = (options: string[], value: string) => {
	const i = options.indexOf(value);
	return i < 0 ? 'var(--text-3)' : `var(--${STATUS_COLORS[i % STATUS_COLORS.length]})`;
};

export const DATE_RANGE_LABEL: Record<DateRange, string> = {
	overdue: 'overdue',
	upcoming: 'upcoming',
	week: 'next 7 days',
	month: 'next 30 days'
};

function inRange(v: string, range: DateRange, today: string): boolean {
	if (!isDate(v)) return false;
	if (range === 'overdue') return v < today;
	if (v < today) return false;
	return range === 'upcoming' || v <= localDay(range === 'week' ? 7 : 30);
}

/**
 * Body rows (indexes into `body`) in display order. `keep` stays visible
 * whatever the filters say: it is the row the cursor is in, so an edit
 * never makes the row being edited vanish.
 */
export function tableView(body: string[][], meta: TableMeta | null, keep: number | null): number[] {
	const today = localDay();
	let rows = body.map((_, i) => i);
	for (const [k, f] of Object.entries(meta?.filter ?? {})) {
		const col = Number(k);
		rows = rows.filter((i) => {
			if (i === keep) return true;
			const v = body[i][col] ?? '';
			if (f.filled && !v) return false;
			if (f.hide?.includes(v)) return false;
			if (f.date && !inRange(v, f.date, today)) return false;
			return true;
		});
	}
	const sort = meta?.sort;
	if (!sort) return rows;
	const type = colType(meta, sort.col);
	const values = body.map((r) => r[sort.col] ?? '');
	const options = type === 'status' ? statusOptions(meta, sort.col, values) : [];
	// Blank or unreadable values sort last either way.
	const key = (v: string): number | string | null => {
		if (!v) return null;
		if (type === 'date' || type === 'deadline') return isDate(v) ? v : null;
		if (type === 'number') return asNumber(v);
		if (type === 'status') return options.indexOf(v);
		return v;
	};
	const keys = values.map(key);
	return rows.sort((a, b) => {
		const x = keys[a];
		const y = keys[b];
		if (x === null || y === null) return x === y ? a - b : x === null ? 1 : -1;
		const c =
			typeof x === 'number' && typeof y === 'number'
				? x - y
				: String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
		return sort.dir * c || a - b;
	});
}
