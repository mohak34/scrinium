import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNotesUnder } from '$lib/server/vault';
import { findTagsInText, matchTag } from '$lib/editor/tags';
import { parseFrontmatter, frontmatterTags, effectiveTitle } from '$lib/editor/frontmatter';

// Exact tag search: notes carrying `?tag=` inline or in the `tags:` key,
// plus nested children (`course` matches `course/neural`). Unlike FTS
// word search this never false-positives on plain-text occurrences.
export const GET: RequestHandler = async ({ url }) => {
	const tag = (url.searchParams.get('tag') ?? '').trim().replace(/^#+/, '');
	if (!tag) throw error(400, 'Missing tag');

	// A note carrying the tag spells it, so the rest are skipped unparsed.
	const low = tag.toLowerCase();
	const out: Array<{ path: string; title: string; snippet: string }> = [];
	for (const { path: p, content } of await readNotesUnder('')) {
		if (!content.toLowerCase().includes(low)) continue;
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
	}
	out.sort((a, b) => a.path.localeCompare(b.path));
	return json(out);
};
