<script lang="ts">
	import { onMount } from 'svelte';
	import { day, listTokens, revokeToken, type Token } from './tokens';

	let tokens = $state<Token[]>([]);
	let loading = $state(true);
	let busy = $state<string | null>(null);
	let copied = $state<string | null>(null);

	// Phone tokens are the unlabeled ones; agent tokens live on the Agents page.
	onMount(async () => {
		try {
			tokens = (await listTokens()).filter((t) => !t.label);
		} finally {
			loading = false;
		}
	});

	async function revoke(t: Token) {
		if (!confirm('Revoke this token? That phone will need to sign in again.')) return;
		busy = t.token_hash;
		try {
			if (await revokeToken(t.token_hash)) tokens = tokens.filter((x) => x.token_hash !== t.token_hash);
		} finally {
			busy = null;
		}
	}

	function copy(value: string) {
		void navigator.clipboard?.writeText(value).catch(() => {});
		copied = value;
		setTimeout(() => copied === value && (copied = null), 1500);
	}
</script>

<div class="sub">Signed in</div>
<p class="hint top">Phones signed in to the Android app. Revoke one to cut it off.</p>
{#if loading}
	<div class="empty">Loading...</div>
{:else if tokens.length === 0}
	<div class="empty">No phones.</div>
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
	.tok {
		font-size: 12.5px;
		word-break: break-all;
	}
</style>
