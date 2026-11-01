import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { mcp } from 'better-auth/plugins';
import { env } from '$env/dynamic/private';
import { db, touchOAuthApp } from './db';

const allowedEmails = (env.ALLOWED_EMAILS || '')
	.split(',')
	.map((e) => e.trim().toLowerCase())
	.filter(Boolean);

if (allowedEmails.length === 0) {
	console.warn(
		'[auth] ALLOWED_EMAILS is empty - nobody will be able to log in. Set it in your .env.'
	);
}

// The actual access-control gate, shared by the web OAuth flow (via
// databaseHooks below) and the mobile token endpoint (/api/auth/mobile).
export function isAllowedEmail(email: string): boolean {
	return allowedEmails.includes(email.toLowerCase());
}

export const auth = betterAuth({
	database: db, // better-auth talks to the same sqlite file directly (better-sqlite3 instance)
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,

	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID as string,
			clientSecret: env.GOOGLE_CLIENT_SECRET as string,
			// Calendar read-only so the tasks calendar can overlay events.
			// accessType offline stores a refresh token for server-side calls.
			// A grant without the scope or refresh token is repaired by
			// connectCalendar (auth-client.ts), which forces a consent screen.
			scope: [
				'openid',
				'email',
				'profile',
				'https://www.googleapis.com/auth/calendar.readonly'
			],
			accessType: 'offline',
			prompt: 'select_account'
		}
	},

	// OAuth for MCP clients that can't send a static token (ChatGPT, claude.ai):
	// they register themselves, the owner signs in with Google as usual and
	// approves on /oauth/consent, and the issued token works on /api like an
	// agent token (hooks.server.ts).
	plugins: [
		mcp({
			loginPage: '/login',
			resource: `${env.BETTER_AUTH_URL}/api/mcp`,
			oidcConfig: { loginPage: '/login', consentPage: '/oauth/consent' }
		})
	],

	// The plugin only asks for consent when the client sends prompt=consent,
	// so without this any registered client could get a code from a signed-in
	// browser silently. Every authorization goes through the consent page.
	// Its token endpoint also accepts a code still waiting on consent, so
	// /mcp/token refuses those itself.
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path === '/mcp/authorize') {
				return { context: { query: { ...ctx.query, prompt: 'consent' } } };
			}
			if (ctx.path === '/mcp/token' && typeof ctx.body?.code === 'string') {
				const pending = await ctx.context.internalAdapter.findVerificationValue(ctx.body.code);
				if (pending && JSON.parse(pending.value).requireConsent) {
					throw new APIError('UNAUTHORIZED', { error: 'invalid_grant', error_description: 'consent required' });
				}
			}
		})
	},

	session: {
		// Refresh the session cookie's expiry on activity so you don't get
		// booted out mid-session, but keep the ceiling reasonable.
		expiresIn: 60 * 60 * 24 * 30, // 30 days
		updateAge: 60 * 60 * 24 // refresh once per day of use
	},

	// This is the actual access-control gate. The Google sign-in screen only
	// proves *who* someone is, not that they're allowed in - anyone with a
	// Google account could otherwise complete the OAuth flow since the
	// subdomain is public DNS. Reject anyone not on the allowlist.
	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					const email = user.email?.toLowerCase();
					if (!email || !isAllowedEmail(email)) {
						throw new Error('This account is not authorized to use this app.');
					}
					return { data: user };
				}
			}
		}
	}
});

// Who sent an OAuth access token from the mcp plugin, or null when the
// token is unknown or expired. Marks the app as used for Settings > Agents.
export async function oauthCaller(headers: Headers): Promise<{ email: string; agent: string } | null> {
	const token = await auth.api.getMcpSession({ headers });
	if (!token) return null;
	const user = await auth.$context.then((c) => c.internalAdapter.findUserById(token.userId));
	if (!user) return null;
	touchOAuthApp(token.clientId);
	return { email: user.email, agent: `oauth:${token.clientId}` };
}
