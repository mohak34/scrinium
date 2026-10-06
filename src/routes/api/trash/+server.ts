import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTrash, purgeFromTrash, emptyTrash } from '$lib/server/vault';

export const GET: RequestHandler = async () => {
	const entries = await listTrash();
	return json(entries);
};

export const DELETE: RequestHandler = async ({ url, request }) => {
	const trashName = url.searchParams.get('trashName');
	// Try JSON body as fallback (for clients that send body with DELETE)
	let bodyName: string | null = null;
	try {
		const body = await request.clone().json();
		if (typeof body?.trashName === 'string') bodyName = body.trashName;
		if (typeof body?.trashName === 'string' && !trashName) {
			// will use bodyName
		}
	} catch {}
	const name = trashName ?? bodyName;
	if (name) {
		// Metadata left the cache when the item was trashed; the name here is
		// a trash name, not a vault path, so there is nothing else to drop.
		await purgeFromTrash(name);
		return json({ ok: true });
	}
	// No name = empty entire trash (explicit action). Require ?all=1 to avoid accidents.
	if (url.searchParams.get('all') === '1') {
		await emptyTrash();
		return json({ ok: true });
	}
	throw error(400, 'Missing trashName. Use ?trashName=<name> or ?all=1 to empty trash.');
};
