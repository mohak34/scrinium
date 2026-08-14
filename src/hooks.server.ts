import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { emailForBearerToken } from '$lib/server/mobileAuth';
import { env } from '$env/dynamic/private';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export const handle: Handle = async ({ event, resolve }) => {
	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));

	const isHub =
		event.request.method === 'GET' &&
		!!env.HUB_SECRET &&
		event.request.headers.get('x-hub-secret') === env.HUB_SECRET &&
		event.url.pathname === '/api/search';

	if (isHub) return resolve(event);

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = session;

	if (!session && !isPublic) {
		if (event.url.pathname.startsWith('/api')) {
			// Mobile client fallback: long-lived API token issued by
			// /api/auth/mobile, sent as `Authorization: Bearer <token>`.
			const authz = event.request.headers.get('authorization');
			const bearer = authz?.match(/^Bearer (.+)$/i)?.[1];
			if (bearer && emailForBearerToken(bearer)) {
				return resolve(event);
			}
			return new Response('Unauthorized', { status: 401 });
		}
		throw redirect(302, '/login');
	}

	// Already logged in and hitting /login? bounce to the app.
	if (session && event.url.pathname === '/login') {
		throw redirect(302, '/');
	}

	return resolve(event);
};
