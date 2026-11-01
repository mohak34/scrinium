import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAgentActions } from '$lib/server/db';
import { listOAuthApps } from '$lib/server/oauthApps';

// GET /api/apps/activity?client_id= -> what that app changed, newest first.
// Browser session only, and only for apps connected to the caller.
export const GET: RequestHandler = async ({ locals, url }) => {
	const user = locals.session?.user;
	if (!user) throw error(401, 'Unauthorized');
	const clientId = url.searchParams.get('client_id') ?? '';
	if (!(await listOAuthApps(user.id)).some((a) => a.client_id === clientId)) throw error(404, 'App not found');
	return json(listAgentActions(`oauth:${clientId}`));
};
