import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteShare, getShare, setSharePassword } from '$lib/server/shares';

// DELETE /api/shares/<id> revokes the link. Idempotent-ish: deleting an
// unknown id is a 404 so the UI can tell "already gone" from "revoked".
export const DELETE: RequestHandler = async ({ params }) => {
	if (!params.id) throw error(400, 'Invalid id');
	if (!getShare(params.id)) throw error(404, 'Share not found');
	deleteShare(params.id);
	return json({ ok: true });
};

// PATCH /api/shares/<id> { password: string | null } sets or changes the
// link's password, or removes it with null. Same 4-200 rule as create.
export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!params.id || !getShare(params.id)) throw error(404, 'Share not found');
	const body = await request.json().catch(() => null);
	const password = body?.password;
	if (password !== null && (typeof password !== 'string' || password.length < 4 || password.length > 200)) {
		throw error(400, 'Password must be 4-200 characters');
	}
	setSharePassword(params.id, password);
	return json(getShare(params.id));
};
