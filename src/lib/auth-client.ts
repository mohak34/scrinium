import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

// Failures (allowlist rejection included) come back to /login?error=<code>
// instead of better-auth's bare error page.
export const signInWithGoogle = () =>
	authClient.signIn.social({ provider: 'google', callbackURL: '/', errorCallbackURL: '/login' });

export const signOut = () => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign('/login') } });

// Incremental consent for the calendar overlay: adds the readonly scope to
// the existing Google grant without touching the login flow. Google only
// issues a refresh token on a consent screen, so force one; better-auth's
// linkSocial has no per-call prompt option, hence the URL edit.
export async function connectCalendar() {
	const { data, error } = await authClient.linkSocial({
		provider: 'google',
		scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
		callbackURL: '/tasks/calendar',
		errorCallbackURL: '/tasks/calendar?calendarError=1',
		disableRedirect: true
	});
	if (error || !data?.url) throw new Error('Could not connect Google Calendar');
	const url = new URL(data.url);
	url.searchParams.set('prompt', 'consent');
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('include_granted_scopes', 'true');
	location.assign(url.toString());
}
