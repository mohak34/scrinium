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
			<button class="btn outline" disabled={busy} onclick={() => answer(false)}>Deny</button>
			<button class="btn primary" disabled={busy} onclick={() => answer(true)}>Allow</button>
		</div>
	</div>
</div>

<style>
	.consent-wrap {
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--panel);
		color: var(--text);
		font-family: var(--font-ui);
	}
	.consent-card {
		max-width: 26rem;
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
	.actions {
		display: flex;
		gap: 8px;
		justify-content: center;
	}
</style>
