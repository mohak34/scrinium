import { OAuth2Client } from 'google-auth-library';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { insertApiToken, findApiToken, touchApiToken, revokeApiToken } from './db';

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// The Android app requests its ID token with the web client ID as
// serverClientId, so the token's audience matches GOOGLE_CLIENT_ID and the
// existing OAuth client verifies it - no separate Android credential needed.
export async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
	try {
		const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
		const email = ticket.getPayload()?.email;
		return email ? email.toLowerCase() : null;
	} catch {
		return null;
	}
}

export function issueApiToken(email: string, label: string | null = null): string {
	const raw = randomBytes(32).toString('base64url');
	insertApiToken(hash(raw), email, label);
	return raw;
}

export function emailForBearerToken(bearer: string): string | null {
	const row = findApiToken(hash(bearer));
	if (!row) return null;
	touchApiToken(row.token_hash);
	return row.user_email;
}

export function revokeBearerToken(bearer: string) {
	revokeApiToken(hash(bearer));
}

// Same hash the api_tokens table is keyed by.
export function hash(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}