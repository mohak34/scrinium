import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { listApiTokensForEmail, listAgentActions } from '$lib/server/db';

// GET /api/tokens/activity?token_hash= -> what that agent changed, newest
// first. Browser session only, and only for the caller's own tokens.
export const GET: RequestHandler = async ({ request, url }) => {
	const session = await auth.api.getSession({ headers: request.headers });
	const email = session?.user?.email;
	if (!email) throw error(401, 'Unauthorized');
	const hash = url.searchParams.get('token_hash') ?? '';
	if (!listApiTokensForEmail(email).some((r) => r.token_hash === hash)) throw error(404, 'Token not found');
	return json(listAgentActions(hash));
};
