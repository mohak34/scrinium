import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import { manifestNotes, safeResolve } from '$lib/server/vault';
import { linkedNotePaths } from '$lib/server/db';
import { sharedNotePaths } from '$lib/server/shares';
import { effectiveTitle, stripFrontmatter } from '$lib/editor/frontmatter';
import { findWikilinksInText, resolveWikilink } from '$lib/editor/wikilinks';

export interface ReviewNote {
	path: string;
	title: string;
	updatedAt: number;
	// Words in the body, title heading and properties left out.
	words: number;
}

// Notes that look abandoned: not edited in `days` days (default 60), no
// other note links to them, no task links to them, no share link. Pinning
// is a browser preference, so the page drops pinned notes itself. A direct
// scan of the vault files, same as backlinks: nothing to keep in sync.
export const GET: RequestHandler = async ({ url }) => {
	const days = Math.max(0, Number(url.searchParams.get('days')) || 60);
	const cutoff = Date.now() - days * 86400000;
	const notes = await manifestNotes();
	const paths = notes.map((n) => n.path);
	const files = await Promise.all(
		notes.map(async (n) => ({
			...n,
			content: await fs.readFile(safeResolve(n.path), 'utf-8').catch(() => '')
		}))
	);

	const linked = new Set<string>();
	for (const f of files) {
		for (const w of findWikilinksInText(f.content)) {
			const to = resolveWikilink(w.target, paths);
			if (to && to !== f.path) linked.add(to);
		}
	}
	const tasked = linkedNotePaths();
	const shared = sharedNotePaths();

	const out: ReviewNote[] = files
		.filter((f) => f.updatedAt < cutoff && !linked.has(f.path) && !tasked.has(f.path) && !shared.has(f.path))
		.map((f) => {
			const body = stripFrontmatter(f.content).replace(/^\s*# .*$/m, '');
			return {
				path: f.path,
				title: effectiveTitle(f.content, f.path),
				updatedAt: Math.round(f.updatedAt),
				words: body.match(/\S+/g)?.length ?? 0
			};
		})
		.sort((a, b) => a.updatedAt - b.updatedAt);
	return json(out);
};
