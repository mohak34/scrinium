<script lang="ts">
	import { onMount } from 'svelte';

	type Token = { token_hash: string; created_at: number; last_used_at: number | null; label: string | null };

	let tokens = $state<Token[]>([]);
	let loading = $state(true);
	let busy = $state<string | null>(null);
	let copied = $state<string | null>(null);
	let label = $state('');
	let creating = $state(false);
	// Raw token from the last create. Shown once, gone when the dialog closes.
	let fresh = $state<{ label: string; token: string } | null>(null);

	const mcpUrl = `${location.origin}/api/mcp`;

	async function load() {
		const res = await fetch('/api/tokens');
		if (res.ok) tokens = await res.json();
	}

	onMount(async () => {
		try {
			await load();
		} finally {
			loading = false;
		}
	});

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const name = label.trim();
		if (!name) return;
		creating = true;
		try {
			const res = await fetch('/api/tokens', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: name })
			});
			if (!res.ok) return;
			fresh = { label: name, token: (await res.json()).token };
			label = '';
			await load();
		} finally {
			creating = false;
		}
	}

	async function revoke(t: Token) {
		const who = t.label ? `"${t.label}" will lose access.` : 'That phone will need to sign in again.';
		if (!confirm(`Revoke this token? ${who}`)) return;
		busy = t.token_hash;
		try {
			const res = await fetch('/api/tokens', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token_hash: t.token_hash })
			});
			if (res.ok) tokens = tokens.filter((x) => x.token_hash !== t.token_hash);
		} finally {
			busy = null;
		}
	}

	function copy(value: string) {
		void navigator.clipboard?.writeText(value).catch(() => {});
		copied = value;
		setTimeout(() => copied === value && (copied = null), 1500);
	}

	const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
</script>

<div class="sub">Agents</div>
<div class="row">
	<div class="txt">
		<span class="lbl">MCP server</span>
		<span class="hint">Give an agent this URL and a token, sent as <span class="mono">Authorization: Bearer</span></span>
	</div>
	<span class="mono url">{mcpUrl}</span>
	<button class="btn ghost" onclick={() => copy(mcpUrl)}>
		<span class="material-symbols-outlined">{copied === mcpUrl ? 'check' : 'content_copy'}</span>
		{copied === mcpUrl ? 'Copied' : 'Copy'}
	</button>
</div>
<form class="row" onsubmit={create}>
	<div class="txt"><span class="lbl">New agent token</span><span class="hint">Name it after the agent that will hold it</span></div>
	<input class="input" bind:value={label} placeholder="Muse" maxlength="60" spellcheck="false" />
	<button class="btn primary" type="submit" disabled={creating || !label.trim()}>Create</button>
</form>
{#if fresh}
	<div class="row">
		<span class="material-symbols-outlined ic warn">key</span>
		<div class="txt">
			<span class="lbl mono tok">{fresh.token}</span>
			<span class="hint">Token for {fresh.label}. Copy it now, it is not shown again</span>
		</div>
		<button class="btn" onclick={() => copy(fresh!.token)}>
			<span class="material-symbols-outlined">{copied === fresh.token ? 'check' : 'content_copy'}</span>
			{copied === fresh.token ? 'Copied' : 'Copy'}
		</button>
	</div>
{/if}

<div class="sub">Signed in</div>
<p class="hint top">Phones signed in to the Android app and agent tokens. Revoke one to cut it off.</p>
{#if loading}
	<div class="empty">Loading...</div>
{:else if tokens.length === 0}
	<div class="empty">No phones or agents.</div>
{:else}
	{#each tokens as t (t.token_hash)}
		<div class="row">
			<span class="material-symbols-outlined ic">{t.label ? 'smart_toy' : 'smartphone'}</span>
			<div class="txt">
				{#if t.label}
					<span class="lbl">{t.label}</span>
				{:else}
					<span class="lbl mono tok">{t.token_hash.slice(0, 12)}...{t.token_hash.slice(-4)}</span>
				{/if}
				<span class="hint">
					Added {day(t.created_at)}, {t.last_used_at ? `last used ${day(t.last_used_at)}` : 'never used'}
				</span>
			</div>
			<button class="btn ghost" onclick={() => copy(t.token_hash)}>
				<span class="material-symbols-outlined">{copied === t.token_hash ? 'check' : 'content_copy'}</span>
				{copied === t.token_hash ? 'Copied' : 'Copy'}
			</button>
			<button class="btn danger" disabled={busy === t.token_hash} onclick={() => revoke(t)}>Revoke</button>
		</div>
	{/each}
{/if}

<style>
	.top {
		margin: 4px 0;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.ic {
		color: var(--text-3);
	}
	.warn {
		color: var(--accent);
	}
	.tok {
		font-size: 12.5px;
		word-break: break-all;
	}
	.url {
		font-size: 12px;
		color: var(--accent);
	}
</style>
