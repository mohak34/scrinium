import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { calendarConnected, userIdForEmail } from '$lib/server/google';

// GET -> { connected } for Settings > Account. 502 when Google is down, so
// the page shows nothing rather than a wrong "Connect" button.
export const GET: RequestHandler = async ({ locals, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store' });
	if (!locals.email) throw error(401, 'Unauthorized');
	const userId = userIdForEmail(locals.email);
	try {
		return json({ connected: await calendarConnected(userId) });
	} catch (e) {
		console.error('[calendar]', e);
		throw error(502, 'Calendar unavailable');
	}
};
