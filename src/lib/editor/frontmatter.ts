/**
 * YAML frontmatter helpers (no editor imports, pure parse + rewrite).
 *
 * A note may open with a `---` block of YAML properties:
 *
 *   ---
 *   title: My Note
 *   author: Ada
 *   tags: [ml, course/neural]
 *   ---
 *   # My Note
 *
 * Shared by the client title<->filename sync, the server title indexing
 * (both must skip the block or a propertied note titles itself `---`),
 * the tags census and the properties panel. Invalid YAML or a non-mapping
 * block means "no frontmatter" - raw text always wins, never a crash.
 */

import { parseDocument, isMap, isPair, type Document } from 'yaml';

export interface Frontmatter {
	data: Record<string, unknown>;
	/** Offset of the first body line past the closing fence. */
	bodyStart: number;
	/** The raw `---...---` block including fences. */
	raw: string;
}

function isOpenFence(line: string): boolean {
	return /^---\s*$/.test(line);
}

function isCloseFence(line: string): boolean {
	return /^(---|\.\.\.)\s*$/.test(line);
}

/** Leading `---` block parsed as a mapping, else null. */
export function parseFrontmatter(text: string): Frontmatter | null {
	const lines = text.split('\n');
	if (!isOpenFence(lines[0] ?? '')) return null;
	let off = lines[0].length + 1;
	for (let i = 1; i < lines.length; i++) {
		if (isCloseFence(lines[i])) {
			const raw = text.slice(0, off + lines[i].length + 1);
			let data: unknown;
			try {
				data = parseDocument(raw.replace(/^---\s*\n/, '').replace(/\n(---|\.\.\.)\s*\n?$/, '')).toJS();
			} catch {
				return null;
			}
			if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
			return { data: data as Record<string, unknown>, bodyStart: raw.length, raw };
		}
		off += lines[i].length + 1;
	}
	return null;
}

/** Text with a leading frontmatter block removed, else unchanged. */
export function stripFrontmatter(text: string): string {
	return text.slice(parseFrontmatter(text)?.bodyStart ?? 0);
}

/** First `# ` heading at or after `from`, with its line index. */
function firstHeading(text: string, from: number): { line: number; title: string } | null {
	const lines = text.split('\n');
	let off = 0;
	for (let i = 0; i < lines.length; i++) {
		const len = lines[i].length + 1;
		if (off + lines[i].length >= from) {
			const m = lines[i].match(/^#\s+(.+?)\s*$/);
			if (m && m[1].trim()) return { line: i, title: m[1].trim() };
		}
		off += len;
	}
	return null;
}

function fmTitle(data: Record<string, unknown>): string | null {
	const v = data['title'];
	if (typeof v === 'string') return v.trim() || null;
	if (typeof v === 'number') return String(v);
	return null;
}

/**
 * Display title: frontmatter `title` wins, then the first `# ` heading
 * below the block, then the caller fallback (usually the filename stem).
 */
export function effectiveTitle(content: string, fallback: string): string {
	const fm = parseFrontmatter(content);
	if (fm) {
		const t = fmTitle(fm.data);
		if (t) return t.slice(0, 200);
	}
	return firstHeading(content, fm?.bodyStart ?? 0)?.title.slice(0, 200) ?? fallback;
}

/** Bare YAML scalar unless quoting is required (`#`, `:`, edges...). */
function yamlScalar(s: string): string {
	if (/^[A-Za-z0-9 _\-/().]+$/.test(s) && !/^\s|\s$/.test(s)) return s;
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Rewrite the same source `effectiveTitle` reads: the `title:` key when
 * the block has one, else the first body `# ` heading. Null when there is
 * nothing to rewrite (sync callers treat that as a no-op, as before).
 */
export function setEffectiveTitle(content: string, newTitle: string): string | null {
	const fm = parseFrontmatter(content);
	const lines = content.split('\n');
	// A `title:` key owns the title; without one the body heading does, so a
	// rename never injects keys the author didn't write.
	if (fm) {
		if (!('title' in fm.data)) {
			const h = firstHeading(content, fm.bodyStart);
			if (!h) return null;
			lines[h.line] = `# ${newTitle}`;
			return lines.join('\n');
		}
		const fmLines = fm.raw.split('\n');
		const idx = fmLines.findIndex((l) => /^\s*title\s*:/.test(l));
		if (idx === -1) return null;
		fmLines[idx] = `title: ${yamlScalar(newTitle)}`;
		return fmLines.join('\n') + content.slice(fm.raw.length);
	}
	const h = firstHeading(content, 0);
	if (!h) return null;
	lines[h.line] = `# ${newTitle}`;
	return lines.join('\n');
}

/**
 * Rewrite the frontmatter block via a YAML Document (preserves comments and
 * key order). Creates the block when missing, drops it when the mutation
 * empties it. Null when there is nothing to write.
 */
export function updateFrontmatterBlock(
	content: string,
	mutate: (doc: Document) => void
): string | null {
	const fm = parseFrontmatter(content);
	if (fm) {
		const doc = parseDocument(fm.raw.replace(/^---\s*\n/, '').replace(/\n(---|\.\.\.)\s*\n?$/, ''));
		try {
			mutate(doc);
		} catch {
			return null;
		}
		if (isEmptyDoc(doc)) return content.slice(fm.bodyStart).replace(/^\n/, '');
		return `---\n${String(doc).trimEnd()}\n---\n` + content.slice(fm.bodyStart);
	}
	const doc = parseDocument('');
	try {
		mutate(doc);
	} catch {
		return null;
	}
	if (isEmptyDoc(doc)) return null;
	const sep = /^\s*$/.test(content.split('\n')[0] ?? '') ? '' : '\n';
	return `---\n${String(doc).trimEnd()}\n---\n${sep}${content}`;
}

/** No content keys: empty docs stringify as `{}`/`null`, not `''`. */
function isEmptyDoc(doc: Document): boolean {
	if (!doc.contents) return true;
	if (isMap(doc.contents)) return doc.contents.items.length === 0;
	return false;
}

/**
 * Rename a top-level key in place: position and comments survive (delete +
 * set would sink the key to the bottom). Refuses missing keys, blank or
 * malformed names, and collisions.
 */
export function renameKey(doc: Document, oldKey: string, newKey: string): boolean {
	if (!/^[A-Za-z0-9_-]+$/.test(newKey) || newKey === oldKey) return false;
	if (!isMap(doc.contents)) return false;
	const nameOf = (p: unknown): string | null =>
		isPair(p) && p.key !== null && typeof p.key === 'object' && 'value' in p.key
			? String((p.key as { value: unknown }).value)
			: null;
	if (doc.contents.items.some((p) => nameOf(p) === newKey)) return false;
	const pair = doc.contents.items.find((p) => nameOf(p) === oldKey);
	if (!pair || !isPair(pair)) return false;
	pair.key = doc.createNode(newKey);
	return true;
}
/**
 * The `tags:` key as a clean list: arrays item-wise, single strings split
 * on commas/whitespace. Leading `#`s tolerated (`tags: "#a, b"`).
 */
export function frontmatterTags(data: Record<string, unknown>): string[] {
	const v = data['tags'];
	const items: unknown[] = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [];
	const out: string[] = [];
	for (const item of items) {
		if (typeof item !== 'string') continue;
		const name = item.trim().replace(/^#+/, '').trim();
		if (name) out.push(name);
	}
	return [...new Set(out)];
}

export interface PropRow {
	key: string;
	display: string;
}

/**
 * Display rows for a properties box: scalars as text (Date to YYYY-MM-DD),
 * scalar arrays comma-joined, nested structures as compact JSON. Edited
 * numbers/bools come back as strings - YAML still reads them fine.
 */
export function propDisplayRows(data: Record<string, unknown>): PropRow[] {
	return Object.entries(data).map(([key, v]) => {
		if (Array.isArray(v)) {
			const flat = v.every((i) => typeof i === 'string' || typeof i === 'number');
			return { key, display: flat ? v.map(String).join(', ') : JSON.stringify(v) };
		}
		if (v instanceof Date) return { key, display: v.toISOString().slice(0, 10) };
		if (v !== null && typeof v === 'object') return { key, display: JSON.stringify(v) };
		return { key, display: v === null || v === undefined ? '' : String(v) };
	});
}
