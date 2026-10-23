import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNotesUnder } from '$lib/server/vault';
import { findUnlinkedMentions, plainExcerpt, wikiResolver } from '$lib/editor/wikilinks';
import { noteLinks } from '$lib/relink';

export interface Backlink {
	path: string;
	excerpt: string;
}

// Notes linking TO `?note=`. Vault files are the source of truth: walk
// the `.md` files, resolve every wikilink and relative markdown link
// outside code like the editor does, keep the ones landing on the target.
// Personal-vault scale makes a direct scan cheaper than another index to
// keep in sync.
export const GET: RequestHandler = async ({ url }) => {
	const target = (url.searchParams.get('note') ?? '').trim();
	if (!target) throw error(400, 'Missing note');

	const files = await readNotesUnder('');
	const links = wikiResolver(files.map((f) => f.path));
	const linked: Backlink[] = [];
	// Any link to the target spells its name, maybe percent-encoded, so a
	// note without it is skipped before the full parse.
	const name = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '').toLowerCase();
	const own = name(target);
	const mayLink = (text: string) => {
		const low = text.toLowerCase();
		if (low.includes(own)) return true;
		if (!low.includes('%')) return false;
		try {
			return decodeURIComponent(low).includes(own);
		} catch {
			return true;
		}
	};
	for (const f of files) {
		if (f.path === target || !mayLink(f.content)) continue;
		const hit = noteLinks(f.content, f.path, links).find((l) => l.target === target);
		if (!hit) continue;
		const start = f.content.lastIndexOf('\n', hit.from - 1) + 1;
		const end = f.content.indexOf('\n', hit.from);
		linked.push({ path: f.path, excerpt: plainExcerpt(f.content.slice(start, end < 0 ? undefined : end)) });
	}
	linked.sort((a, b) => a.path.localeCompare(b.path));
	// Mentions only from notes that don't link yet, and never a same-named
	// note's own title.
	const done = new Set(linked.map((l) => l.path));
	const rest = files.filter((f) => !done.has(f.path) && name(f.path) !== own);
	return json({ linked, unlinked: findUnlinkedMentions(target, rest) as Backlink[] });
};
