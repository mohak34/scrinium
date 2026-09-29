import { OAuth2Client } from 'google-auth-library';
import { env } from '$env/dynamic/private';
import { db } from './db';

// Server-side Google API access using the tokens better-auth stores in the
// `account` table. Short-lived access tokens are refreshed on demand with
// the stored refresh token (requires accessType offline + a fresh consent).

interface AccountRow {
	accessToken: string | null;
	refreshToken: string | null;
	accessTokenExpiresAt: string | number | null;
}

function parseExpiry(v: string | number | null): number {
	if (v == null) return 0;
	if (typeof v === 'number') return v;
	const n = Date.parse(v);
	return Number.isFinite(n) ? n : 0;
}

export async function getGoogleAccessToken(
	userId: string
): Promise<{ token: string } | { needsConnect: true }> {
	const row = db
		.prepare(
			`SELECT accessToken, refreshToken, accessTokenExpiresAt FROM account
			 WHERE userId = ? AND providerId = 'google' ORDER BY updatedAt DESC LIMIT 1`
		)
		.get(userId) as AccountRow | undefined;
	if (!row) return { needsConnect: true };
	if (row.accessToken && parseExpiry(row.accessTokenExpiresAt) - Date.now() > 60000) {
		return { token: row.accessToken };
	}
	if (!row.refreshToken) return { needsConnect: true };
	try {
		const client = new OAuth2Client(
			env.GOOGLE_CLIENT_ID as string,
			env.GOOGLE_CLIENT_SECRET as string
		);
		client.setCredentials({ refresh_token: row.refreshToken });
		const { token, res } = await client.getAccessToken();
		if (!token) return { needsConnect: true };
		const expiresIn = Number(res?.data?.expires_in) || 3600;
		db.prepare(
			`UPDATE account SET accessToken = ?, accessTokenExpiresAt = ?, updatedAt = ?
			 WHERE userId = ? AND providerId = 'google'`
		).run(token, new Date(Date.now() + expiresIn * 1000).toISOString(), new Date().toISOString(), userId);
		return { token };
	} catch {
		return { needsConnect: true };
	}
}

export class GoogleAuthError extends Error {}

export interface GEvent {
	id: string;
	title: string;
	start: number;
	end: number;
	allDay: boolean;
}

export async function fetchCalendarEvents(
	token: string,
	timeMin: string,
	timeMax: string
): Promise<GEvent[]> {
	const url =
		`https://www.googleapis.com/calendar/v3/calendars/primary/events` +
		`?singleEvents=true&orderBy=startTime&maxResults=250` +
		`&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (res.status === 401 || res.status === 403) throw new GoogleAuthError('Google rejected the token');
	if (!res.ok) throw new Error(`Calendar fetch failed: ${res.status}`);
	const data = (await res.json()) as {
		items?: {
			id?: string;
			status?: string;
			summary?: string;
			start?: { dateTime?: string; date?: string };
			end?: { dateTime?: string; date?: string };
		}[];
	};
	const out: GEvent[] = [];
	for (const it of data.items ?? []) {
		if (!it || it.status === 'cancelled') continue;
		const s = it.start?.dateTime ?? it.start?.date;
		const e = it.end?.dateTime ?? it.end?.date;
		if (!s || !e) continue;
		const start = Date.parse(s);
		const end = Date.parse(e);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		out.push({
			id: it.id ?? `${start}-${it.summary ?? 'event'}`,
			title: it.summary?.trim() || '(no title)',
			start,
			end,
			allDay: it.start?.dateTime == null
		});
	}
	return out;
}
