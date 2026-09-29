import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

export const signInWithGoogle = () =>
	authClient.signIn.social({ provider: 'google', callbackURL: '/' });

export const signOut = () => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign('/login') } });

// Incremental consent for the calendar overlay: adds the readonly scope to
// the existing Google grant without touching the login flow.
export const connectCalendar = () =>
	authClient.linkSocial({
		provider: 'google',
		scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
		callbackURL: '/tasks/calendar'
	});
