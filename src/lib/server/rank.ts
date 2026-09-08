// Title-aware ranking for vault search. FTS BM25 scores body and title
// alike, and the exact/prefix merge appends prefix hits last - so a note
// merely mentioning "work" outranked "Workbench Theme Test File". Buckets
// below fix the order; the FTS rank only breaks ties inside a bucket.
// Lower wins. Query and tokens must already be lowercased.
export function titleScore(title: string, path: string, query: string, tokens: string[]): number {
	const t = title.toLowerCase();
	if (query && t.startsWith(query)) return 0;
	const words = t.split(/[^a-z0-9]+/).filter(Boolean);
	if (tokens.some((tok) => tok && words.some((w) => w.startsWith(tok)))) return 1;
	if (tokens.some((tok) => tok && t.includes(tok))) return 2;
	const p = path.toLowerCase();
	if (tokens.some((tok) => tok && p.includes(tok))) return 3;
	return 4;
}
