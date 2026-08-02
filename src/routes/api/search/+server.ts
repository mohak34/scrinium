import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchNotes, listRecentNotes } from '$lib/server/db';
import { ensureIndex } from '$lib/server/indexer';

export const GET: RequestHandler = async ({ url }) => {
	await ensureIndex();
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) {
		return json(listRecentNotes(15));
	}
	if (q.length < 2) return json([]);
	return json(searchNotes(q));
};
