import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { archiveToTrash } from '$lib/server/bins';

// Move an archived item { name } to the trash. It keeps its original path,
// so restoring it from the trash puts it back in the vault.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.name !== 'string' || !body.name) throw error(400, 'Missing name');
	const e = await archiveToTrash(body.name);
	return json({ trashName: e.name, originalPath: e.originalPath });
};
