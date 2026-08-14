import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyGoogleIdToken, issueApiToken } from '$lib/server/mobileAuth';
import { isAllowedEmail } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const idToken = typeof body?.googleIdToken === 'string' ? body.googleIdToken : '';
	if (!idToken) throw error(400, 'Missing googleIdToken');

	const email = await verifyGoogleIdToken(idToken);
	if (!email) throw error(401, 'Invalid Google ID token');
	if (!isAllowedEmail(email)) throw error(403, 'This account is not authorized to use this app.');

	return json({ apiToken: issueApiToken(email), email });
};