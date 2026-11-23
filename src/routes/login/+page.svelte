<script lang="ts">
	import { page } from '$app/state';
	import { signInWithGoogle } from '$lib/auth-client';

	// ?error= from the hooks (session for an email no longer allowed) or
	// from better-auth's OAuth callback (sign-up rejected by the allowlist).
	const error = $derived(page.url.searchParams.get('error'));
	const message = $derived(
		!error
			? ''
			: error === 'not_allowed' || error === 'unable_to_create_user'
				? 'That Google account is not on the allowlist.'
				: 'Sign-in failed. Try again.'
	);
</script>

<div class="login-wrap">
	<div class="login-card">
		<h1>Scrinium</h1>
		<p>Sign in with the Google account on the allowlist.</p>
		{#if message}<p class="err">{message}</p>{/if}
		<button class="btn primary" onclick={signInWithGoogle}>Continue with Google</button>
	</div>
</div>

<style>
	.login-wrap {
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--panel);
		color: var(--text);
		font-family: var(--font-ui);
	}
	.login-card {
		text-align: center;
		padding: 32px 36px 28px;
		border-radius: var(--r-pane);
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--rim), var(--shadow);
	}
	h1 {
		margin: 0 0 6px;
		font: 600 var(--t-title) / 1.2 var(--font-ui);
		color: var(--text);
	}
	p {
		color: var(--text-3);
		margin: 0 0 20px;
		font-size: var(--t-meta);
	}
	.err {
		color: var(--red);
	}
</style>
