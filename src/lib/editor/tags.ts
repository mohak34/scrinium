/**
 * Shared `#tag` helpers (no editor imports, pure parsing).
 *
 * Syntax: `#tag`, `#nested/tag`, letters/digits/`_`/`-` per segment.
 * The `#` must start the line or follow whitespace/opening punctuation,
 * so `foo#bar`, URL fragments and `# headings` never match. Pure-numeric
 * bodies (`#123`) are not tags. Frontmatter, fenced code and `[[...]]`
 * spans are skipped here; inline code and math are the callers' job via
 * `isInsideCode`/block ranges (same contract as `findWikilinksInText`).
 */

import { findWikilinksInText } from './wikilinks';

export interface Tag {
	from: number;
	to: number;
	/** Body without the leading `#`, e.g. `nested/tag`. */
	name: string;
}

const TAG_RE = /(^|[\s([{'"“‘>])#([A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)*)/gm;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Offset just past a leading `---` frontmatter block, else 0. */
function frontmatterEnd(text: string): number {
	if (!/^---\s*(\n|$)/.test(text)) return 0;
	const lines = text.split('\n');
	let off = lines[0].length + 1;
	for (let i = 1; i < lines.length; i++) {
		if (/^(---|\.\.\.)\s*$/.test(lines[i])) return off + lines[i].length + 1;
		off += lines[i].length + 1;
	}
	return text.length;
}

/** Line-based fenced-code ranges (``` / ~~~), inclusive of fences. */
function fenceRanges(text: string): Array<{ from: number; to: number }> {
	const ranges: Array<{ from: number; to: number }> = [];
	const lines = text.split('\n');
	let off = 0;
	let open: number | null = null;
	for (const line of lines) {
		if (FENCE_RE.test(line)) {
			if (open === null) open = off;
			else {
				ranges.push({ from: open, to: off + line.length });
				open = null;
			}
		}
		off += line.length + 1;
	}
	if (open !== null) ranges.push({ from: open, to: text.length });
	return ranges;
}

export function findTagsInText(text: string): Tag[] {
	const skipFm = frontmatterEnd(text);
	const fences = fenceRanges(text);
	const links = findWikilinksInText(text);
	const out: Tag[] = [];
	TAG_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TAG_RE.exec(text)) !== null) {
		const from = m.index + m[1].length;
		// `[text](#heading)` is a link to a heading, not a tag.
		if (m[1] === '(' && text[m.index - 1] === ']') continue;
		let name = m[2].replace(/[-_]+$/, '');
		if (!name || /\/$/.test(name)) continue;
		const to = from + 1 + name.length;
		if (from < skipFm) continue;
		if (fences.some((r) => from >= r.from && from < r.to)) continue;
		if (links.some((w) => from >= w.from && from < w.to)) continue;
		out.push({ from, to, name });
	}
	return out;
}

/** Unique tag names in first-seen order (rail panel + dedupe). */
export function uniqueTagNames(text: string): string[] {
	const seen = new Set<string>();
	for (const t of findTagsInText(text)) seen.add(t.name);
	return [...seen];
}

/**
 * Which of a note's tags satisfy a tag query: exact match or a nested
 * child (`course` matches `course/neural`), case-insensitive like
 * resolution. Leading `#` on the query tolerated.
 */
export function matchTag(noteTags: string[], query: string): string[] {
	const q = query.replace(/^#+/, '').toLowerCase();
	if (!q) return [];
	return noteTags.filter((t) => {
		const low = t.toLowerCase();
		return low === q || low.startsWith(`${q}/`);
	});
}
