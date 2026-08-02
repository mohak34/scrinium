<script lang="ts">
	import { signInWithGoogle } from '$lib/auth-client';
</script>

<div class="login-wrap">
	<div class="login-card">
		<h1>Scrinium</h1>
		<p>Sign in with the Google account on the allowlist.</p>
		<button onclick={signInWithGoogle}>Continue with Google</button>
	</div>
</div>

<style>
	.login-wrap {
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #14151a;
		color: #e6e6e6;
		font-family: system-ui, sans-serif;
	}
	.login-card {
		text-align: center;
		padding: 2.5rem 3rem;
		border-radius: 12px;
		background: #1c1e26;
		border: 1px solid #2a2d38;
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
	}
	p {
		color: #9a9daa;
		margin: 0 0 1.5rem;
		font-size: 0.9rem;
	}
	button {
		background: #4f7cff;
		color: white;
		border: none;
		padding: 0.65rem 1.25rem;
		border-radius: 8px;
		font-size: 0.95rem;
		cursor: pointer;
	}
	button:hover {
		background: #6690ff;
	}
</style>
