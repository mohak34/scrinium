<script lang="ts">
	import { onMount } from 'svelte';

	type Token = { token_hash: string; created_at: number; last_used_at: number | null; label: string | null };
	type Action = { tool: string; target: string; at: number };

	// MCP write tools as past-tense verbs for the activity list.
	const VERBS: Record<string, string> = {
		create_note: 'Created note',
		update_note: 'Rewrote note',
		edit_note: 'Edited note',
		append_to_note: 'Appended to',
		move_note: 'Moved',
		create_folder: 'Created folder',
		delete_note: 'Trashed',
		restore_from_trash: 'Restored',
		share_note: 'Shared',
		create_task: 'Created task',
		update_task: 'Updated task',
		delete_task: 'Deleted task',
		link_task_to_note: 'Linked a task to',
		unlink_task_from_note: 'Unlinked a task from'
	};

	let tokens = $state<Token[]>([]);
	let loading = $state(true);
	let busy = $state<string | null>(null);
	let copied = $state<string | null>(null);
	let label = $state('');
	let creating = $state(false);
	// Raw token from the last create. Shown once, gone when the dialog closes.
	let fresh = $state<{ label: string; token: string } | null>(null);
	// Activity of the one expanded agent; null while collapsed.
	let open = $state<{ hash: string; actions: Action[] | null } | null>(null);

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

	async function toggleActivity(hash: string) {
		if (open?.hash === hash) {
			open = null;
			return;
		}
		open = { hash, actions: null };
		const res = await fetch(`/api/tokens/activity?token_hash=${encodeURIComponent(hash)}`);
		if (open?.hash === hash) open = { hash, actions: res.ok ? await res.json() : [] };
	}

	function copy(value: string) {
		void navigator.clipboard?.writeText(value).catch(() => {});
		copied = value;
		setTimeout(() => copied === value && (copied = null), 1500);
	}

	const stamp = (ms: number) =>
		new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
			{#if t.label}
				<button class="btn ghost" class:on={open?.hash === t.token_hash} onclick={() => toggleActivity(t.token_hash)}>
					<span class="material-symbols-outlined">history</span>
					Activity
				</button>
			{/if}
			<button class="btn ghost" onclick={() => copy(t.token_hash)}>
				<span class="material-symbols-outlined">{copied === t.token_hash ? 'check' : 'content_copy'}</span>
				{copied === t.token_hash ? 'Copied' : 'Copy'}
			</button>
			<button class="btn danger" disabled={busy === t.token_hash} onclick={() => revoke(t)}>Revoke</button>
		</div>
		{#if open?.hash === t.token_hash}
			<div class="log">
				{#if open.actions === null}
					<div class="hint">Loading...</div>
				{:else if open.actions.length === 0}
					<div class="hint">No changes in the last 30 days.</div>
				{:else}
					{#each open.actions as a, i (i)}
						<div class="act">
							<span class="when">{stamp(a.at)}</span>
							<span class="what">{VERBS[a.tool] ?? a.tool}</span>
							<span class="tgt">{a.target}</span>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
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
	:global(.dlg) .btn.ghost.on {
		color: var(--accent);
	}
	.log {
		padding: 6px 0 12px 40px;
		border-bottom: 1px solid var(--line);
		max-height: 260px;
		overflow-y: auto;
		font-size: var(--fs-sm);
	}
	.log .hint {
		color: var(--text-3);
	}
	.act {
		display: flex;
		gap: 12px;
		padding: 3px 0;
		white-space: nowrap;
	}
	.when {
		width: 110px;
		flex: none;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.what {
		flex: none;
		color: var(--text-2);
	}
	.tgt {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
	}
	.url {
		font-size: 12px;
		color: var(--accent);
	}
</style>
