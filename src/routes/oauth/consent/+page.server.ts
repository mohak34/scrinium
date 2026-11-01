import { error } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

// The mcp plugin sends the browser here with ?consent_code&client_id&scope
// after sign-in. Clients register themselves, so the page shows where the
// code would go (the redirect hosts), not just the name the client picked.
export const load: PageServerLoad = async ({ url }) => {
	const consentCode = url.searchParams.get('consent_code');
	const clientId = url.searchParams.get('client_id');
	if (!consentCode || !clientId) error(400, 'Missing consent request');
	const ctx = await auth.$context;
	const client = await ctx.adapter.findOne<{ name: string; redirectUrls: string }>({
		model: 'oauthApplication',
		where: [{ field: 'clientId', value: clientId }]
	});
	if (!client) error(400, 'Unknown client');
	const hosts = [...new Set(client.redirectUrls.split(',').map((u) => URL.parse(u)?.host ?? u))];
	return { consentCode, name: client.name, hosts };
};
