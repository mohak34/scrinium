<script lang="ts">
	import { onMount } from 'svelte';

	type Token = { token_hash: string; created_at: number; last_used_at: number | null };

	let tokens = $state<Token[]>([]);
	let loading = $state(true);
	let busy = $state<string | null>(null);
	let copied = $state<string | null>(null);

	onMount(async () => {
		try {
			const res = await fetch('/api/tokens');
			if (res.ok) tokens = await res.json();
		} finally {
			loading = false;
		}
	});

	async function revoke(hash: string) {
		if (!confirm('Revoke this token? That phone will need to sign in again.')) return;
		busy = hash;
		try {
			const res = await fetch('/api/tokens', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token_hash: hash })
			});
			if (res.ok) tokens = tokens.filter((t) => t.token_hash !== hash);
		} finally {
			busy = null;
		}
	}

	function copy(hash: string) {
		void navigator.clipboard?.writeText(hash).catch(() => {});
		copied = hash;
		setTimeout(() => copied === hash && (copied = null), 1500);
	}

	const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
</script>

<p class="hint top">Each phone signed in to the Android app holds one token. Revoke one to sign that phone out.</p>
{#if loading}
	<div class="empty">Loading...</div>
{:else if tokens.length === 0}
	<div class="empty">No phones signed in.</div>
{:else}
	{#each tokens as t (t.token_hash)}
		<div class="row">
			<span class="material-symbols-outlined ic">smartphone</span>
			<div class="txt">
				<span class="lbl mono tok">{t.token_hash.slice(0, 12)}...{t.token_hash.slice(-4)}</span>
				<span class="hint">
					Added {day(t.created_at)}, {t.last_used_at ? `last used ${day(t.last_used_at)}` : 'never used'}
				</span>
			</div>
			<button class="btn ghost" onclick={() => copy(t.token_hash)}>
				<span class="material-symbols-outlined">{copied === t.token_hash ? 'check' : 'content_copy'}</span>
				{copied === t.token_hash ? 'Copied' : 'Copy'}
			</button>
			<button class="btn danger" disabled={busy === t.token_hash} onclick={() => revoke(t.token_hash)}>Revoke</button>
		</div>
	{/each}
{/if}

<style>
	.top {
		margin: 16px 0 4px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.ic {
		color: var(--text-3);
	}
	.tok {
		font-size: 12.5px;
	}
</style>
