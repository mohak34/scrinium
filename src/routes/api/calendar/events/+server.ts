import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { getGoogleAccessToken, fetchCalendarEvents, GoogleAuthError } from '$lib/server/google';

// Read-only overlay for the tasks calendar: Google events in a time window.
// Never writes, never stores - each call goes to Google with the user's token.
export const GET: RequestHandler = async ({ request, url }) => {
	const session = await auth.api.getSession({ headers: request.headers });
	const userId = session?.user?.id;
	if (!userId) throw error(401, 'Unauthorized');

	const from = Number(url.searchParams.get('from'));
	const to = Number(url.searchParams.get('to'));
	if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
		throw error(400, 'Bad time range');
	}
	if (to - from > 93 * 86400000) throw error(400, 'Range too wide');

	const access = await getGoogleAccessToken(userId);
	if ('needsConnect' in access) return json({ events: [], needsConnect: true });

	try {
		const events = await fetchCalendarEvents(
			access.token,
			new Date(from).toISOString(),
			new Date(to).toISOString()
		);
		return json({ events });
	} catch (e) {
		if (e instanceof GoogleAuthError) return json({ events: [], needsConnect: true });
		throw error(502, 'Calendar unavailable');
	}
};
