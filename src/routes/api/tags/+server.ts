import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import { safeResolve } from '$lib/server/vault';
import { findTagsInText } from '$lib/editor/tags';
import { parseFrontmatter, frontmatterTags } from '$lib/editor/frontmatter';

export interface TagCount {
	tag: string;
	count: number;
}

// Vault-wide `#tag` census for `#` completion and the rail panel. Direct
// vault scan like /api/backlinks: personal-vault scale makes it cheaper
// than another index to keep in sync. Count = notes containing the tag.
export const GET: RequestHandler = async () => {
	const paths: string[] = [];
	async function walk(relDir = ''): Promise<void> {
		let dirents;
		try {
			dirents = await fs.readdir(safeResolve(relDir), { withFileTypes: true });
		} catch {
			return;
		}
		for (const d of dirents) {
			if (d.name.startsWith('.')) continue;
			const rel = relDir ? `${relDir}/${d.name}` : d.name;
			if (d.isDirectory()) await walk(rel);
			else if (d.name.toLowerCase().endsWith('.md')) paths.push(rel);
		}
	}
	await walk();

	const counts = new Map<string, number>();
	await Promise.all(
		paths.map(async (p) => {
			let content: string;
			try {
				content = await fs.readFile(safeResolve(p), 'utf-8');
			} catch {
				return;
			}
			const found = new Set(findTagsInText(content).map((t) => t.name));
			// A `tags:` key counts the same as inline `#tags`.
			const fm = parseFrontmatter(content);
			if (fm) for (const t of frontmatterTags(fm.data)) found.add(t);
			for (const name of found) counts.set(name, (counts.get(name) ?? 0) + 1);
		})
	);
	const out: TagCount[] = [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
	return json(out);
};
