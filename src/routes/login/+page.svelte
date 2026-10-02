<script lang="ts">
	import { signInWithGoogle } from '$lib/auth-client';
</script>

<div class="login-wrap">
	<div class="login-card">
		<h1>Scrinium</h1>
		<p>Sign in with the Google account on the allowlist.</p>
		<button class="signin" onclick={signInWithGoogle}>Continue with Google</button>
	</div>
</div>

<style>
	.login-wrap {
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background);
		color: var(--on-surface);
		font-family: var(--font-ui);
	}
	.login-card {
		text-align: center;
		padding: 2.5rem 3rem;
		border-radius: var(--radius-lg);
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		color: var(--on-surface);
	}
	p {
		color: var(--on-surface-variant);
		margin: 0 0 1.5rem;
		font-size: var(--font-ui-small);
	}
	.signin {
		background: var(--accent-fill);
		color: var(--on-accent);
		font-weight: 600;
		border: none;
		padding: 0.65rem 1.25rem;
		border-radius: var(--radius);
		font-size: var(--font-ui-medium);
		font-family: var(--font-ui);
		cursor: pointer;
	}
	.signin:hover {
		background: var(--accent-fill-hi);
	}
</style>