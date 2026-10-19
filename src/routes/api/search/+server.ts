import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchNotes, listRecentNotes, type SearchScope } from '$lib/server/db';
import { ensureIndex } from '$lib/server/indexer';

const SCOPES: SearchScope[] = ['vault', 'archive', 'all'];

// ?scope=archive searches only archived notes, ?scope=all both; archived
// hits carry their ".archive/..." path. Plain search leaves the archive out.
// ?folder= keeps hits inside one folder.
export const GET: RequestHandler = async ({ url }) => {
	await ensureIndex();
	const q = (url.searchParams.get('q') ?? '').trim();
	const scope = SCOPES.find((s) => s === url.searchParams.get('scope')) ?? 'vault';
	if (!q) {
		return json(scope === 'archive' ? [] : listRecentNotes(15));
	}
	if (q.length < 2) return json([]);
	return json(searchNotes(q, scope, url.searchParams.get('folder') || undefined));
};
