import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listOAuthApps, revokeOAuthApp } from '$lib/server/oauthApps';

// OAuth apps connected to the caller's account. Browser session only: an
// app can't list or revoke apps.
export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.session?.user;
	if (!user) throw error(401, 'Unauthorized');
	return json(await listOAuthApps(user.id));
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = locals.session?.user;
	if (!user) throw error(401, 'Unauthorized');
	const body = await request.json().catch(() => null);
	const clientId = typeof body?.client_id === 'string' ? body.client_id : '';
	if (!(await listOAuthApps(user.id)).some((a) => a.client_id === clientId)) throw error(404, 'App not found');
	await revokeOAuthApp(user.id, clientId);
	return json({ ok: true });
};
