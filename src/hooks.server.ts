import type { Handle, ServerInit } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getMigrations } from 'better-auth/db/migration';
import { timingSafeEqual } from 'node:crypto';
import { auth, isAllowedEmail } from '$lib/server/auth';
import { emailForBearerToken } from '$lib/server/mobileAuth';
import { env } from '$env/dynamic/private';

// Bring the better-auth tables up to date once at startup. Idempotent: it
// only creates missing tables/columns, so deploys need no migrate CLI.
export const init: ServerInit = async () => {
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
};

const PUBLIC_PATHS =['/login', '/api/auth', '/s', '/api/share'];

export const handle: Handle = async ({ event, resolve }) => {
	// Segment-boundary match: '/api/share' must not accidentally publicize
	// '/api/shares', and '/s' must not open '/settings' or '/search'.
	const isPublic = PUBLIC_PATHS.some(
		(p) => event.url.pathname === p || event.url.pathname.startsWith(p + '/')
	);

	const isHub =
		event.request.method === 'GET' &&
		event.url.pathname === '/api/search' &&
		sameSecret(event.request.headers.get('x-hub-secret'), env.HUB_SECRET);

	if (isHub) return resolve(event);

	// The allowlist is checked on every request, not only at sign-up, so
	// removing an email from ALLOWED_EMAILS locks that account out at once
	// (live sessions and API tokens alike) without touching the database.
	const found = await auth.api.getSession({ headers: event.request.headers });
	const session = found && isAllowedEmail(found.user.email) ? found : null;
	event.locals.session = session;

	if (!session && !isPublic) {
		if (event.url.pathname.startsWith('/api')) {
			// Mobile client fallback: long-lived API token issued by
			// /api/auth/mobile, sent as `Authorization: Bearer <token>`.
			const authz = event.request.headers.get('authorization');
			const bearer = authz?.match(/^Bearer (.+)$/i)?.[1];
			const email = bearer ? emailForBearerToken(bearer) : null;
			if (email && isAllowedEmail(email)) {
				return resolve(event);
			}
			return new Response('Unauthorized', { status: 401 });
		}
		throw redirect(302, found ? '/login?error=not_allowed' : '/login');
	}

	// Already logged in and hitting /login? bounce to the app.
	if (session && event.url.pathname === '/login') {
		throw redirect(302, '/');
	}

	return resolve(event);
};

// Constant-time compare so the hub secret can't be guessed byte by byte.
function sameSecret(given: string | null, expected: string | undefined): boolean {
	if (!given || !expected) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
