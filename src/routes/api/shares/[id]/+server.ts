import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteShare, getShare } from '$lib/server/shares';

// DELETE /api/shares/<id> revokes the link. Idempotent-ish: deleting an
// unknown id is a 404 so the UI can tell "already gone" from "revoked".
export const DELETE: RequestHandler = async ({ params }) => {
	if (!params.id) throw error(400, 'Invalid id');
	if (!getShare(params.id)) throw error(404, 'Share not found');
	deleteShare(params.id);
	return json({ ok: true });
};
