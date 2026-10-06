import { OAuth2Client } from 'google-auth-library';
import { env } from '$env/dynamic/private';
import { db } from './db';
import type { CalendarEvent } from '../calendar';

// Server-side Google API access using the tokens better-auth stores in the
// `account` table. Short-lived access tokens are refreshed on demand with
// the stored refresh token (requires accessType offline + a fresh consent).
// Only a missing grant needs the user to reconnect; Google outages throw so
// the UI says "unavailable" instead of asking for a pointless reconnect.

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
	const client = new OAuth2Client(env.GOOGLE_CLIENT_ID as string, env.GOOGLE_CLIENT_SECRET as string);
	client.setCredentials({ refresh_token: row.refreshToken });
	try {
		const { token } = await client.getAccessToken();
		if (!token) throw new Error('Google returned no access token');
		const expiry = client.credentials.expiry_date ?? Date.now() + 3600 * 1000;
		db.prepare(
			`UPDATE account SET accessToken = ?, accessTokenExpiresAt = ?, updatedAt = ?
			 WHERE userId = ? AND providerId = 'google'`
		).run(token, new Date(expiry).toISOString(), new Date().toISOString(), userId);
		return { token };
	} catch (e) {
		// invalid_grant: the user revoked access or the refresh token expired.
		const code = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
		if (code === 'invalid_grant') return { needsConnect: true };
		throw e;
	}
}

// The grant is missing, revoked or lacks the calendar scope: reconnect.
export class GoogleAuthError extends Error {}

const API = 'https://www.googleapis.com/calendar/v3';

async function google<T>(token: string, url: URL): Promise<T> {
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(15000)
	});
	if (res.status === 401) throw new GoogleAuthError('Google rejected the token');
	if (res.status === 403) {
		const body = (await res.json().catch(() => null)) as {
			error?: { errors?: { reason?: string }[] };
		} | null;
		const reasons = body?.error?.errors?.map((x) => x.reason) ?? [];
		if (reasons.includes('insufficientPermissions')) {
			throw new GoogleAuthError('Calendar permission required');
		}
	}
	if (!res.ok) throw new Error(`Google Calendar ${url.pathname} failed: ${res.status}`);
	return (await res.json()) as T;
}

interface CalendarRef {
	id: string;
	name: string;
	color: string | null;
}

// Calendars the user has ticked in Google Calendar's sidebar, primary first.
async function listCalendars(token: string): Promise<CalendarRef[]> {
	const url = new URL(`${API}/users/me/calendarList`);
	url.searchParams.set('minAccessRole', 'reader');
	const out: CalendarRef[] = [];
	for (;;) {
		const data = await google<{
			nextPageToken?: string;
			items?: {
				id?: string;
				summary?: string;
				summaryOverride?: string;
				backgroundColor?: string;
				selected?: boolean;
				primary?: boolean;
			}[];
		}>(token, url);
		for (const c of data.items ?? []) {
			if (!c.id || (!c.selected && !c.primary)) continue;
			const ref = { id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor ?? null };
			if (c.primary) out.unshift(ref);
			else out.push(ref);
		}
		if (!data.nextPageToken) return out;
		url.searchParams.set('pageToken', data.nextPageToken);
	}
}

interface GoogleEvent {
	id?: string;
	iCalUID?: string;
	status?: string;
	summary?: string;
	start?: { dateTime?: string; date?: string };
	end?: { dateTime?: string; date?: string };
}

async function listEvents(token: string, cal: CalendarRef, timeMin: string, timeMax: string) {
	const url = new URL(`${API}/calendars/${encodeURIComponent(cal.id)}/events`);
	url.search = new URLSearchParams({
		singleEvents: 'true',
		orderBy: 'startTime',
		maxResults: '250',
		timeMin,
		timeMax
	}).toString();
	const items: GoogleEvent[] = [];
	for (;;) {
		const data = await google<{ nextPageToken?: string; items?: GoogleEvent[] }>(token, url);
		items.push(...(data.items ?? []));
		if (!data.nextPageToken) return items;
		url.searchParams.set('pageToken', data.nextPageToken);
	}
}

// Events from every selected calendar in [timeMin, timeMax). The primary
// calendar must load; a failing secondary calendar (unsubscribed, shared
// access removed) is skipped so one bad calendar never blanks the overlay.
// An invite that sits on two calendars shows once.
export async function fetchCalendarEvents(
	token: string,
	timeMin: string,
	timeMax: string
): Promise<CalendarEvent[]> {
	const calendars = await listCalendars(token);
	if (!calendars.length) calendars.push({ id: 'primary', name: 'Google', color: null });
	const results = await Promise.allSettled(
		calendars.map((c) => listEvents(token, c, timeMin, timeMax))
	);
	const out: CalendarEvent[] = [];
	const seen = new Set<string>();
	results.forEach((r, i) => {
		const cal = calendars[i];
		if (r.status === 'rejected') {
			if (i === 0) throw r.reason;
			return;
		}
		for (const it of r.value) {
			const start = it.start?.dateTime ?? it.start?.date;
			const end = it.end?.dateTime ?? it.end?.date;
			if (it.status === 'cancelled' || !it.id || !start || !end) continue;
			if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) continue;
			const key = `${it.iCalUID ?? it.id}@${start}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				id: `${cal.id}:${it.id}`,
				calendar: cal.name,
				color: cal.color,
				title: it.summary?.trim() || '(no title)',
				start,
				end,
				allDay: it.start?.dateTime == null
			});
		}
	});
	return out;
}

// Cheap connection probe for Settings > Account: a valid token that can
// read the calendar list.
export async function calendarConnected(userId: string): Promise<boolean> {
	const access = await getGoogleAccessToken(userId);
	if ('needsConnect' in access) return false;
	try {
		await google(access.token, new URL(`${API}/users/me/calendarList?maxResults=1`));
		return true;
	} catch (e) {
		if (e instanceof GoogleAuthError) return false;
		throw e;
	}
}
