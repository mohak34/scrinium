import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listBin, purgeFromTrash, emptyTrash, binPath } from '$lib/server/vault';
import { deleteTaskLinksByPrefix } from '$lib/server/db';

// Trash rows keep their original field names (trashName, deletedAt): the
// phone app and MCP read them.
export const GET: RequestHandler = async () => {
	const entries = await listBin('trash');
	return json(
		entries.map(({ name, movedAt, ...e }) => ({ ...e, trashName: name, deletedAt: movedAt }))
	);
};

export const DELETE: RequestHandler = async ({ url, request }) => {
	// The name rides in the query, or in a JSON body for clients that send one.
	let name = url.searchParams.get('trashName');
	if (!name) {
		const body = await request.json().catch(() => null);
		if (typeof body?.trashName === 'string') name = body.trashName;
	}
	if (name) {
		// Metadata left the cache when the item was trashed; only the task
		// links that rode along to the trash path are left to drop.
		await purgeFromTrash(name);
		deleteTaskLinksByPrefix(binPath('trash', name));
		return json({ ok: true });
	}
	// No name = empty entire trash (explicit action). Require ?all=1 to avoid accidents.
	if (url.searchParams.get('all') === '1') {
		await emptyTrash();
		deleteTaskLinksByPrefix('.trash');
		return json({ ok: true });
	}
	throw error(400, 'Missing trashName. Use ?trashName=<name> or ?all=1 to empty trash.');
};
