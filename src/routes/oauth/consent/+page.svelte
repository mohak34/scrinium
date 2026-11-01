<script lang="ts">
	let { data } = $props();
	let busy = $state(false);
	let failed = $state(false);

	// better-auth answers with the client's redirect URI: the code on allow,
	// an access_denied error on deny.
	async function answer(accept: boolean) {
		busy = true;
		failed = false;
		const res = await fetch('/api/auth/oauth2/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ accept, consent_code: data.consentCode })
		});
		const body = res.ok ? ((await res.json()) as { redirectURI?: string }) : null;
		if (body?.redirectURI) return location.assign(body.redirectURI);
		busy = false;
		failed = true;
	}
</script>

<div class="consent-wrap">
	<div class="consent-card">
		<h1>Connect {data.name}?</h1>
		<p>It gets full access to your notes and tasks. It sends you back to {data.hosts.join(', ')}.</p>
		{#if failed}<p class="err">That request expired. Start the connection again.</p>{/if}
		<div class="actions">
			<button class="deny" disabled={busy} onclick={() => answer(false)}>Deny</button>
			<button class="allow" disabled={busy} onclick={() => answer(true)}>Allow</button>
		</div>
	</div>
</div>

<style>
	.consent-wrap {
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background);
		color: var(--on-surface);
		font-family: var(--font-ui);
	}
	.consent-card {
		max-width: 26rem;
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
	.err {
		color: var(--red);
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
	}
	button {
		border: none;
		padding: 0.65rem 1.25rem;
		border-radius: var(--radius);
		font-size: var(--font-ui-medium);
		font-family: var(--font-ui);
		font-weight: 600;
		cursor: pointer;
	}
	.allow {
		background: var(--accent-fill);
		color: var(--on-accent);
	}
	.allow:hover {
		background: var(--accent-fill-hi);
	}
	.deny {
		background: transparent;
		color: var(--on-surface);
		border: 1px solid var(--border-raised);
	}
</style>
