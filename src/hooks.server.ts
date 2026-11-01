import type { Handle, ServerInit } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getMigrations } from 'better-auth/db/migration';
import { timingSafeEqual } from 'node:crypto';
import { auth, isAllowedEmail, oauthCaller } from '$lib/server/auth';
import { emailForBearerToken, hash } from '$lib/server/mobileAuth';
import { migrateAreasToProjects } from '$lib/server/db';
import { createFolder, safeResolve } from '$lib/server/vault';
import { readdir } from 'node:fs/promises';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

// Bring the better-auth tables up to date once at startup. Idempotent: it
// only creates missing tables/columns, so deploys need no migrate CLI. Old
// task areas become projects here, where the vault's folders are known.
export const init: ServerInit = async () => {
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	const dirents = await readdir(safeResolve(''), { withFileTypes: true }).catch(() => []);
	const roots = dirents.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
	// A folder that can't be made (a file holds the name) must not stop the
	// app: the project still works on the board, and making the folder by
	// hand later attaches it.
	for (const path of migrateAreasToProjects(roots)) {
		await createFolder(path).catch((e) => console.error(`project folder ${path}:`, e));
	}
};

const PUBLIC_PATHS = ['/login', '/api/auth', '/s', '/api/share', '/.well-known'];

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

	// Local previews with a throwaway vault, where Google sign-in can't
	// reach: `bun run dev` with DEV_LOGIN_EMAIL set signs every request in
	// as that email. `dev` is false in builds, so production never does.
	if (dev && env.DEV_LOGIN_EMAIL) {
		event.locals.session = null;
		event.locals.email = env.DEV_LOGIN_EMAIL;
		event.locals.agent = null;
		return resolve(event);
	}

	// The allowlist is checked on every request, not only at sign-up, so
	// removing an email from ALLOWED_EMAILS locks that account out at once
	// (live sessions and API tokens alike) without touching the database.
	const found = await auth.api.getSession({ headers: event.request.headers });
	const session = found && isAllowedEmail(found.user.email) ? found : null;
	event.locals.session = session;
	event.locals.email = session?.user.email ?? null;
	event.locals.agent = null;

	if (!session && !isPublic) {
		if (event.url.pathname.startsWith('/api')) {
			// Token fallback, sent as `Authorization: Bearer <token>`: a
			// long-lived API token (phone, Settings > Agents) or an OAuth
			// access token from the mcp plugin (ChatGPT, claude.ai).
			const authz = event.request.headers.get('authorization');
			const bearer = authz?.match(/^Bearer (.+)$/i)?.[1];
			let caller: { email: string; agent: string } | null = null;
			if (bearer) {
				const email = emailForBearerToken(bearer);
				caller = email ? { email, agent: hash(bearer) } : await oauthCaller(event.request.headers);
			}
			if (caller && isAllowedEmail(caller.email)) {
				event.locals.email = caller.email;
				event.locals.agent = caller.agent;
				return resolve(event);
			}
			// The header points MCP clients at the OAuth metadata so they can
			// start the sign-in flow. Behind Caddy url.origin is plain http.
			const origin = (env.BETTER_AUTH_URL || event.url.origin).replace(/\/+$/, '');
			return new Response('Unauthorized', {
				status: 401,
				headers: {
					'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
				}
			});
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
