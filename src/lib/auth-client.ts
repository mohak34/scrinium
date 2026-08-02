import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

export const signInWithGoogle = () =>
	authClient.signIn.social({ provider: 'google', callbackURL: '/' });

export const signOut = () => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign('/login') } });
