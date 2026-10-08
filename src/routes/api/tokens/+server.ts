import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listApiTokensForEmail, revokeApiToken } from '$lib/server/db';
import { issueApiToken } from '$lib/server/mobileAuth';

// GET and DELETE take a browser session or an API token: the phone lists
// and revokes signed-in devices with its own token.
export const GET: RequestHandler = async ({ locals }) => {
	const email = locals.email;
	if (!email) throw error(401, 'Unauthorized');
	const rows = listApiTokensForEmail(email);
	// Don't expose full hash in logs but return it for revoke; client masks it.
	return json(
		rows.map((r) => ({
			token_hash: r.token_hash,
			created_at: r.created_at,
			last_used_at: r.last_used_at,
			label: r.label
		}))
	);
};

// Mint a token for an agent (MCP client) from a browser session. The raw
// token is returned once; only its hash is kept. A token can't mint tokens.
export const POST: RequestHandler = async ({ request, locals }) => {
	const email = locals.session?.user.email;
	if (!email) throw error(401, 'Unauthorized');
	const body = await request.json().catch(() => null);
	const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 60) : '';
	if (!label) throw error(400, 'Label is required');
	return json({ token: issueApiToken(email, label) }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const email = locals.email;
	if (!email) throw error(401, 'Unauthorized');
	const body = await request.json().catch(() => null);
	const hash = typeof body?.token_hash === 'string' ? body.token_hash : '';
	if (!hash) throw error(400, 'Missing token_hash');
	const rows = listApiTokensForEmail(email);
	if (!rows.some((r) => r.token_hash === hash)) throw error(404, 'Token not found');
	revokeApiToken(hash);
	return json({ ok: true });
};
