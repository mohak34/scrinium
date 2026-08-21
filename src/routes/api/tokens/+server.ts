import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { listApiTokensForEmail, revokeApiToken } from '$lib/server/db';

export const GET: RequestHandler = async ({ request }) => {
	const session = await auth.api.getSession({ headers: request.headers });
	const email = session?.user?.email;
	if (!email) throw error(401, 'Unauthorized');
	const rows = listApiTokensForEmail(email);
	// Don't expose full hash in logs but return it for revoke; client masks it.
	return json(
		rows.map((r) => ({
			token_hash: r.token_hash,
			created_at: r.created_at,
			last_used_at: r.last_used_at
		}))
	);
};

export const DELETE: RequestHandler = async ({ request }) => {
	const session = await auth.api.getSession({ headers: request.headers });
	const email = session?.user?.email;
	if (!email) throw error(401, 'Unauthorized');
	const body = await request.json().catch(() => null);
	const hash = typeof body?.token_hash === 'string' ? body.token_hash : '';
	if (!hash) throw error(400, 'Missing token_hash');
	const rows = listApiTokensForEmail(email);
	if (!rows.some((r) => r.token_hash === hash)) throw error(404, 'Token not found');
	revokeApiToken(hash);
	return json({ ok: true });
};
