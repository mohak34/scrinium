import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

// Failures (allowlist rejection included) come back to /login?error=<code>
// instead of better-auth's bare error page.
export const signInWithGoogle = () =>
	authClient.signIn.social({ provider: 'google', callbackURL: '/', errorCallbackURL: '/login' });

export const signOut = () => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign('/login') } });

// Incremental consent for the calendar overlay: adds the readonly scope to
// the existing Google grant without touching the login flow.
export const connectCalendar = () =>
	authClient.linkSocial({
		provider: 'google',
		scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
		callbackURL: '/tasks/calendar'
	});
