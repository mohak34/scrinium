import { auth } from './auth';
import { forgetOAuthApp, oauthAppLastUsed } from './db';

// OAuth apps (MCP clients that signed in, like ChatGPT or OpenCode) as
// Settings > Agents lists them. An app counts as connected while the user
// holds a token for it that can still be used or refreshed.
export interface OAuthApp {
	client_id: string;
	name: string;
	connected_at: number;
	last_used_at: number | null;
}

type TokenRow = { clientId: string; createdAt: Date; accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date | null };

export async function listOAuthApps(userId: string): Promise<OAuthApp[]> {
	const { adapter } = await auth.$context;
	const now = Date.now();
	const tokens = await adapter.findMany<TokenRow>({
		model: 'oauthAccessToken',
		where: [{ field: 'userId', value: userId }]
	});
	const first = new Map<string, number>();
	for (const t of tokens) {
		const live = Math.max(t.accessTokenExpiresAt.getTime(), t.refreshTokenExpiresAt?.getTime() ?? 0) > now;
		if (!live) continue;
		const at = t.createdAt.getTime();
		first.set(t.clientId, Math.min(first.get(t.clientId) ?? at, at));
	}
	if (first.size === 0) return [];
	const apps = await adapter.findMany<{ clientId: string; name: string }>({
		model: 'oauthApplication',
		where: [{ field: 'clientId', operator: 'in', value: [...first.keys()] }]
	});
	return apps
		.map((a) => ({
			client_id: a.clientId,
			name: a.name,
			connected_at: first.get(a.clientId)!,
			last_used_at: oauthAppLastUsed(a.clientId)
		}))
		.sort((a, b) => (b.last_used_at ?? b.connected_at) - (a.last_used_at ?? a.connected_at));
}

// Cuts an app off: drops every token the user holds for it (live access
// tokens stop working at once) and the consent, so it has to be approved
// again. The app's registration stays; it is not tied to one user.
export async function revokeOAuthApp(userId: string, clientId: string) {
	const { adapter } = await auth.$context;
	const where = [
		{ field: 'clientId', value: clientId },
		{ field: 'userId', value: userId }
	];
	await adapter.deleteMany({ model: 'oauthAccessToken', where });
	await adapter.deleteMany({ model: 'oauthConsent', where });
	forgetOAuthApp(clientId);
}
