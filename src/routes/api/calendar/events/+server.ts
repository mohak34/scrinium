import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { getGoogleAccessToken, fetchCalendarEvents, GoogleAuthError } from '$lib/server/google';

// Read-only overlay for the tasks calendar: Google events in a time window.
// Never writes, never stores - each call goes to Google with the user's token.
// { needsConnect: true } means the grant is missing; a 502 means Google is
// unreachable and the client should just try again later.
export const GET: RequestHandler = async ({ request, url, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store' });
	const session = await auth.api.getSession({ headers: request.headers });
	const userId = session?.user?.id;
	if (!userId) throw error(401, 'Unauthorized');

	const from = Number(url.searchParams.get('from'));
	const to = Number(url.searchParams.get('to'));
	if (!url.searchParams.get('from') || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
		throw error(400, 'Bad time range');
	}
	if (to - from > 93 * 86400000) throw error(400, 'Range too wide');

	try {
		const access = await getGoogleAccessToken(userId);
		if ('needsConnect' in access) return json({ events: [], needsConnect: true });
		const events = await fetchCalendarEvents(
			access.token,
			new Date(from).toISOString(),
			new Date(to).toISOString()
		);
		return json({ events });
	} catch (e) {
		if (e instanceof GoogleAuthError) return json({ events: [], needsConnect: true });
		console.error('[calendar]', e);
		throw error(502, 'Calendar unavailable');
	}
};
