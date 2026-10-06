import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { calendarConnected } from '$lib/server/google';

// GET -> { connected } for Settings > Account. 502 when Google is down, so
// the page shows nothing rather than a wrong "Connect" button.
export const GET: RequestHandler = async ({ request, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store' });
	const session = await auth.api.getSession({ headers: request.headers });
	const userId = session?.user?.id;
	if (!userId) throw error(401, 'Unauthorized');
	try {
		return json({ connected: await calendarConnected(userId) });
	} catch (e) {
		console.error('[calendar]', e);
		throw error(502, 'Calendar unavailable');
	}
};
