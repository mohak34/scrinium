import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export const handle: Handle = async ({ event, resolve }) => {
	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = session;

	if (!session && !isPublic) {
		if (event.url.pathname.startsWith('/api')) {
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
