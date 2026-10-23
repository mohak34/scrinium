/**
 * Shared `[[wikilink]]` helpers (no editor imports, pure parsing + resolve).
 *
 * Syntax: `[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]`,
 * `[[Note#heading|alias]]`, and `[[#heading]]` (empty target: the note
 * the link sits in). Image embeds (`![[...]]`) are not wikilinks
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

const WIKILINK_RE = /\[\[([^\][#|\n]*)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]/g;

/** Parse one `[[...]]` occurrence. Null when malformed or empty. */
export function parseWikilinkText(inner: string): {
	target: string;
	heading: string | null;
	alias: string | null;
} | null {
	const m = /^([^\][#|]*)(?:#([^\]|]*))?(?:\|([^\]]*))?$/.exec(inner);
	if (!m) return null;
	const target = m[1].trim();
	const heading = m[2] !== undefined ? m[2].trim() : null;
	if (!target && !heading) return null;
	return { target, heading, alias: m[3] !== undefined ? m[3] : null };
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

/** Text shown for the link: alias, else the target as written (the heading for `[[#heading]]`). */
export function wikilinkDisplay(w: Pick<Wikilink, 'target' | 'heading' | 'alias'>): string {
	if (w.alias !== null && w.alias !== '') return w.alias;
	return w.target || (w.heading ?? '');
}

/**
 * The shortest way to write a link to `path`: its bare name when that
 * resolves back to it, else the vault path without `.md`. A link written
 * with a folder keeps one, so `[[Uni/Note]]` never collapses to `[[Note]]`.
 */
export function wikiTargetFor(path: string, links: WikiResolver, keepFolder = false): string {
	const name = stem(path);
	return !keepFolder && links.resolve(name) === path ? name : path.replace(/\.md$/i, '');
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stem(p: string): string {
	const base = p.split('/').pop() ?? p;
	return base.replace(/\.md$/i, '');
}

/**
 * Lookups over one list of note paths, built once so resolving many links
 * costs a map hit each instead of a scan of every path.
 *
 * `exact`: the note a link names by its full path (case-insensitive, the
 * first such path in list order), no basename fallback.
 * `resolve`: exact path first, then basename-stem match case-insensitively
 * with the shortest path winning, ties alphabetical (Obsidian's rule).
 * Both return null when unresolved.
 */
export interface WikiResolver {
	exact(target: string): string | null;
	resolve(target: string): string | null;
}

function withMdExt(target: string): string | null {
	const t = target.trim();
	if (!t) return null;
	return /\.md$/i.test(t) ? t : `${t}.md`;
}

export function wikiResolver(notePaths: readonly string[]): WikiResolver {
	const byPath = new Map<string, string>();
	const byStem = new Map<string, string>();
	for (const p of notePaths) {
		const low = p.toLowerCase();
		if (!byPath.has(low)) byPath.set(low, p);
		const key = stem(p).toLowerCase();
		const best = byStem.get(key);
		if (best === undefined || p.length < best.length || (p.length === best.length && p.localeCompare(best) < 0)) {
			byStem.set(key, p);
		}
	}
	const exact = (target: string): string | null => {
		const t = withMdExt(target);
		return t === null ? null : (byPath.get(t.toLowerCase()) ?? null);
	};
	return {
		exact,
		resolve(target) {
			const hit = exact(target);
			if (hit) return hit;
			const t = withMdExt(target);
			return t === null ? null : (byStem.get(stem(t).toLowerCase()) ?? null);
		}
	};
}

/** One-off `exact` lookup; build a `wikiResolver` for many links. */
export function exactWikilink(target: string, notePaths: string[]): string | null {
	return wikiResolver(notePaths).exact(target);
}

/** One-off `resolve` lookup; build a `wikiResolver` for many links. */
export function resolveWikilink(target: string, notePaths: string[]): string | null {
	return wikiResolver(notePaths).resolve(target);
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

/**
 * Where clicking an unresolved link creates its note: `[[Name]]` next to
 * the note it sits in, `[[Folder/Name]]` at that vault path. Null when a
 * segment is unusable (empty, a dot name, nothing left after stripping
 * characters filenames can't hold).
 */
export function wikilinkNewPath(target: string, currentPath: string | null): string | null {
	const segs = target
		.trim()
		.replace(/\.md$/i, '')
		.split('/')
		.map((s) => s.trim().replace(/[\\:*?"<>|]/g, ''));
	if (segs.some((s) => !s || s.startsWith('.'))) return null;
	const rel = `${segs.join('/')}.md`;
	if (segs.length > 1) return rel;
	const dir = currentPath?.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : null;
	return dir ? `${dir}/${rel}` : rel;
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
	const low = name.toLowerCase();
	const out: UnlinkedMention[] = [];
	for (const f of files) {
		if (f.path === target || !f.content.toLowerCase().includes(low)) continue;
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
 * the author's original casing (resolution is case-insensitive). When the
 * bare name would resolve to another note it links by path with the
 * mention as alias. Null when there is nothing convertible.
 */
export function linkFirstMention(content: string, target: string, links: WikiResolver): string | null {
	const name = stem(target);
	const path = wikiTargetFor(target, links);
	if (name.length < 2) return null;
	const re = new RegExp(`\\b(${escapeRegExp(name)})\\b`, 'gi');
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const spans = findWikilinksInText(lines[i]);
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(lines[i])) !== null) {
			if (spans.some((s) => m!.index >= s.from && m!.index < s.to)) continue;
			const link = path === name ? `[[${m[1]}]]` : `[[${path}|${m[1]}]]`;
			lines[i] = lines[i].slice(0, m.index) + link + lines[i].slice(m.index + m[0].length);
			return lines.join('\n');
		}
	}
	return null;
}
