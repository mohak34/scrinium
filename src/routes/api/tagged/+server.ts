import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import { safeResolve } from '$lib/server/vault';
import { findTagsInText, matchTag } from '$lib/editor/tags';
import { parseFrontmatter, frontmatterTags, effectiveTitle } from '$lib/editor/frontmatter';

// Exact tag search: notes carrying `?tag=` inline or in the `tags:` key,
// plus nested children (`course` matches `course/neural`). Unlike FTS
// word search this never false-positives on plain-text occurrences.
export const GET: RequestHandler = async ({ url }) => {
	const tag = (url.searchParams.get('tag') ?? '').trim().replace(/^#+/, '');
	if (!tag) throw error(400, 'Missing tag');

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

	const out: Array<{ path: string; title: string; snippet: string }> = [];
	await Promise.all(
		paths.map(async (p) => {
			let content: string;
			try {
				content = await fs.readFile(safeResolve(p), 'utf-8');
			} catch {
				return;
			}
			const tags = findTagsInText(content).map((t) => t.name);
			const fm = parseFrontmatter(content);
			if (fm) tags.push(...frontmatterTags(fm.data));
			const matched = matchTag([...new Set(tags)], tag);
			if (matched.length) {
				out.push({
					path: p,
					title: effectiveTitle(content, p),
					snippet: matched.map((t) => `#${t}`).join(' ')
				});
			}
		})
	);
	out.sort((a, b) => a.path.localeCompare(b.path));
	return json(out);
};
