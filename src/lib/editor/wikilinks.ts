/**
 * Shared `[[wikilink]]` helpers (no editor imports, pure parsing + resolve).
 *
 * Syntax: `[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]`,
 * `[[Note#heading|alias]]`. Image embeds (`![[...]]`) are not wikilinks
 * and never match. Used by livePreview.ts (decorations + completion),
 * the backlinks API (reference scan) and renderNote.ts (print HTML).
 */

export interface Wikilink {
	from: number;
	to: number;
	target: string;
	heading: string | null;
	alias: string | null;
}

const WIKILINK_RE = /\[\[([^\][#|\n]+)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]/g;

/** Parse one `[[...]]` occurrence. Null when malformed or empty. */
export function parseWikilinkText(inner: string): {
	target: string;
	heading: string | null;
	alias: string | null;
} | null {
	const m = /^([^\][#|]+)(?:#([^\]|]*))?(?:\|([^\]]*))?$/.exec(inner);
	if (!m) return null;
	const target = m[1].trim();
	if (!target) return null;
	return {
		target,
		heading: m[2] !== undefined ? m[2].trim() : null,
		alias: m[3] !== undefined ? m[3] : null
	};
}

/** Scan plain text for wikilinks. Positions are offsets into `text`. */
export function findWikilinksInText(text: string): Wikilink[] {
	const out: Wikilink[] = [];
	WIKILINK_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = WIKILINK_RE.exec(text)) !== null) {
		// Image embeds (`![[...]]`) are not navigable links.
		if (m.index > 0 && text[m.index - 1] === '!') continue;
		const parsed = parseWikilinkText(m[0].slice(2, -2));
		if (!parsed) continue;
		out.push({
			from: m.index,
			to: m.index + m[0].length,
			target: parsed.target,
			heading: parsed.heading,
			alias: parsed.alias
		});
	}
	return out;
}

/** Text shown for the link: alias, else the target as written. */
export function wikilinkDisplay(w: Pick<Wikilink, 'target' | 'alias'>): string {
	if (w.alias !== null && w.alias !== '') return w.alias;
	return w.target;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stem(p: string): string {
	const base = p.split('/').pop() ?? p;
	return base.replace(/\.md$/i, '');
}

/**
 * Resolve a link target to a vault-relative `.md` path. Exact path first
 * (`target` or `target.md`), then basename-stem match case-insensitively
 * with shortest path winning (Obsidian's rule). Null when unresolved.
 */
export function resolveWikilink(target: string, notePaths: string[]): string | null {
	const t = target.trim();
	if (!t) return null;
	const withExt = /\.md$/i.test(t) ? t : `${t}.md`;
	const exact = notePaths.find((p) => p === withExt || p.toLowerCase() === withExt.toLowerCase());
	if (exact) return exact;
	const want = stem(withExt).toLowerCase();
	const cands = notePaths.filter((p) => stem(p).toLowerCase() === want);
	if (!cands.length) return null;
	cands.sort((a, b) => a.length - b.length || a.localeCompare(b));
	return cands[0];
}

/** Flatten a file tree to vault-relative `.md` paths. */
export function notePathsFromTree(
	entries: Array<{ path: string; type: string; children?: unknown[] }>
): string[] {
	const out: string[] = [];
	const walk = (
		nodes: Array<{ path: string; type: string; children?: unknown[] }>
	): void => {
		for (const e of nodes) {
			if (e.type === 'file' && e.path.toLowerCase().endsWith('.md')) out.push(e.path);
			if (Array.isArray(e.children)) {
				walk(
					e.children as Array<{ path: string; type: string; children?: unknown[] }>
				);
			}
		}
	};
	walk(entries);
	return out;
}

/** Sanitize a link target into a same-folder filename, null when unusable. */
export function wikilinkFilename(target: string): string | null {
	const name = target
		.trim()
		.replace(/\.md$/i, '')
		.replace(/[\\/:*?"<>|]/g, '');
	if (!name || name === '.' || name === '..' || name.startsWith('.')) return null;
	return `${name}.md`;
}

export interface BacklinkMatch {
	path: string;
	excerpt: string;
}

/**
 * The matching line with every `[[...]]` replaced by its display text
 * (alias, else target) - excerpts read as prose instead of markup.
 */
export function plainExcerpt(line: string): string {
	let out = '';
	let last = 0;
	for (const w of findWikilinksInText(line)) {
		out += line.slice(last, w.from);
		out += w.alias?.trim() ? w.alias.trim() : w.target;
		last = w.to;
	}
	return (out + line.slice(last)).trim().slice(0, 160);
}

/** Notes linking TO target (first matching line as excerpt, one per file). */
export function findBacklinks(
	target: string,
	files: Array<{ path: string; content: string }>
): BacklinkMatch[] {
	const notes = files.map((f) => f.path);
	const out: BacklinkMatch[] = [];
	for (const f of files) {
		if (f.path === target) continue;
		for (const line of f.content.split('\n')) {
			const hit = findWikilinksInText(line).some(
				(w) => resolveWikilink(w.target, notes) === target
			);
			if (hit) {
				out.push({ path: f.path, excerpt: plainExcerpt(line) });
				break;
			}
		}
	}
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

export interface UnlinkedMention {
	path: string;
	excerpt: string;
}

/**
 * Plain-text name drops of the target note: the stem appears outside any
 * `[[...]]`. Case-insensitive like resolution; single-char stems are noise
 * and never match.
 */
export function findUnlinkedMentions(
	target: string,
	files: Array<{ path: string; content: string }>
): UnlinkedMention[] {
	const name = stem(target);
	if (name.length < 2) return [];
	const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
	const out: UnlinkedMention[] = [];
	for (const f of files) {
		if (f.path === target) continue;
		for (const line of f.content.split('\n')) {
			const spans = findWikilinksInText(line);
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			let bare = false;
			while ((m = re.exec(line)) !== null) {
				if (!spans.some((s) => m!.index >= s.from && m!.index < s.to)) {
					bare = true;
					break;
				}
			}
			if (bare) {
				out.push({ path: f.path, excerpt: plainExcerpt(line) });
				break;
			}
		}
	}
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

/**
 * Wrap the first bare mention of the target's stem in `[[...]]`, keeping
 * the author's original casing (resolution is case-insensitive). Null when
 * there is nothing convertible.
 */
export function linkFirstMention(content: string, target: string): string | null {
	const name = stem(target);
	if (name.length < 2) return null;
	const re = new RegExp(`\\b(${escapeRegExp(name)})\\b`, 'gi');
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const spans = findWikilinksInText(lines[i]);
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(lines[i])) !== null) {
			if (spans.some((s) => m!.index >= s.from && m!.index < s.to)) continue;
			lines[i] = lines[i].slice(0, m.index) + `[[${m[1]}]]` + lines[i].slice(m.index + m[0].length);
			return lines.join('\n');
		}
	}
	return null;
}
