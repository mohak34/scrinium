<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { flushSave, openTab } from '$lib/stores/vault';
	import { settingsPage } from '$lib/stores/settingsDialog';
	import { day } from './tokens';

	type Share = { id: string; notePath: string; createdAt: number; hasPassword: boolean };

	let shares = $state<Share[]>([]);
	let loading = $state(true);
	let filter = $state('');
	let busy = $state<string | null>(null);
	let copied = $state<string | null>(null);
	// The one link whose password editor is open.
	let editing = $state<string | null>(null);
	let password = $state('');
	let error = $state('');

	const linkFor = (id: string) => `${location.origin}/s/${id}`;

	// The API returns links sorted by note, so grouping is one pass.
	const groups = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		const out: { path: string; links: Share[] }[] = [];
		for (const s of shares) {
			if (q && !s.notePath.toLowerCase().includes(q)) continue;
			const last = out.at(-1);
			if (last?.path === s.notePath) last.links.push(s);
			else out.push({ path: s.notePath, links: [s] });
		}
		return out;
	});

	onMount(async () => {
		try {
			const res = await fetch('/api/shares');
			if (res.ok) shares = await res.json();
		} finally {
			loading = false;
		}
	});

	async function open(path: string) {
		await flushSave();
		openTab(path);
		settingsPage.set(null);
		if (page.url.pathname !== '/') await goto('/');
	}

	async function revoke(s: Share) {
		if (!confirm('Revoke this link? Anyone holding it loses access.')) return;
		busy = s.id;
		try {
			const res = await fetch(`/api/shares/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
			if (res.ok || res.status === 404) shares = shares.filter((x) => x.id !== s.id);
		} finally {
			busy = null;
		}
	}

	function edit(s: Share) {
		editing = editing === s.id ? null : s.id;
		password = '';
		error = '';
	}

	// null removes the password.
	async function savePassword(s: Share, value: string | null) {
		busy = s.id;
		error = '';
		try {
			const res = await fetch(`/api/shares/${encodeURIComponent(s.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: value })
			});
			if (!res.ok) {
				error = 'Could not update the password.';
				return;
			}
			const next: Share = await res.json();
			shares = shares.map((x) => (x.id === s.id ? next : x));
			editing = null;
			password = '';
		} finally {
			busy = null;
		}
	}

	function copy(id: string) {
		void navigator.clipboard?.writeText(linkFor(id)).catch(() => {});
		copied = id;
		setTimeout(() => copied === id && (copied = null), 1500);
	}
</script>

<div class="head">
	<p class="hint top">Every public link in the vault. Create new ones from a note's Share button.</p>
	<input class="input" placeholder="Filter by note" bind:value={filter} />
</div>
{#if loading}
	<div class="empty">Loading...</div>
{:else if shares.length === 0}
	<div class="empty">No shared links.</div>
{:else if groups.length === 0}
	<div class="empty">No links match.</div>
{:else}
	{#each groups as g (g.path)}
		<button class="sub note" title="Open note" onclick={() => void open(g.path)}>{g.path}</button>
		{#each g.links as s (s.id)}
			<div class="row">
				<span class="material-symbols-outlined ic" title={s.hasPassword ? 'Password protected' : 'Open link'}>
					{s.hasPassword ? 'lock' : 'link'}
				</span>
				<div class="txt">
					<span class="lbl mono url">{linkFor(s.id)}</span>
					<span class="hint">Created {day(s.createdAt)}{s.hasPassword ? ', password protected' : ''}</span>
				</div>
				<button class="btn ghost" onclick={() => copy(s.id)}>
					<span class="material-symbols-outlined">{copied === s.id ? 'check' : 'content_copy'}</span>
					{copied === s.id ? 'Copied' : 'Copy'}
				</button>
				<button class="btn" disabled={busy === s.id} onclick={() => edit(s)}>
					{s.hasPassword ? 'Password' : 'Add password'}
				</button>
				<button class="btn danger" disabled={busy === s.id} onclick={() => void revoke(s)}>Revoke</button>
			</div>
			{#if editing === s.id}
				<form
					class="pw"
					onsubmit={(e) => {
						e.preventDefault();
						void savePassword(s, password);
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="input"
						type="password"
						placeholder={s.hasPassword ? 'New password (4+ chars)' : 'Password (4+ chars)'}
						autocomplete="new-password"
						autofocus
						bind:value={password}
					/>
					<button class="btn primary" disabled={busy === s.id || password.length < 4 || password.length > 200}>
						Save
					</button>
					{#if s.hasPassword}
						<button type="button" class="btn danger" disabled={busy === s.id} onclick={() => void savePassword(s, null)}>
							Remove password
						</button>
					{/if}
					<button type="button" class="btn ghost" onclick={() => (editing = null)}>Cancel</button>
					{#if error}<span class="err">{error}</span>{/if}
				</form>
			{/if}
		{/each}
	{/each}
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 16px;
		margin: 8px 0 4px;
	}
	.top {
		flex: 1;
		margin: 0;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.note {
		display: block;
		max-width: 100%;
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}
	.note:hover {
		color: var(--accent);
	}
	.ic {
		color: var(--text-3);
	}
	.url {
		font-size: 12.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pw {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 0 12px 40px;
		border-bottom: 1px solid var(--line);
	}
	.err {
		color: var(--red);
		font-size: var(--fs-sm);
	}
</style>
