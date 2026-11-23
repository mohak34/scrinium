<script lang="ts">
	import { activePath } from '$lib/stores/vault';
	import { SHARE_LIFETIMES, expiryLabel } from '$lib/shareExpiry';
	import Select from './Select.svelte';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	interface Share {
		id: string;
		notePath: string;
		createdAt: number;
		hasPassword: boolean;
		expiresAt: number | null;
	}

	let shares = $state<Share[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let usePassword = $state(false);
	let password = $state('');
	let lifetime = $state<number | null>(null);
	let error = $state('');
	let copiedId = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	const path = $derived($activePath);
	const linkFor = (id: string) => `${window.location.origin}/s/${id}`;

	async function refresh(notePath: string) {
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/shares?path=${encodeURIComponent(notePath)}`);
			if (!res.ok) throw new Error();
			shares = (await res.json()) as Share[];
		} catch {
			error = 'Could not load share links.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (path) void refresh(path);
	});

	async function create() {
		if (!path || creating) return;
		if (usePassword && (password.length < 4 || password.length > 200)) {
			error = 'Password must be 4-200 characters.';
			return;
		}
		creating = true;
		error = '';
		try {
			const res = await fetch('/api/shares', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path, password: usePassword ? password : undefined, expiresInDays: lifetime })
			});
			if (!res.ok) {
				error = res.status === 404 ? 'Note has unsaved changes - wait a moment and retry.' : 'Could not create link.';
				return;
			}
			password = '';
			usePassword = false;
			lifetime = null;
			await refresh(path);
		} finally {
			creating = false;
		}
	}

	async function revoke(id: string) {
		await fetch(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
		if (path) await refresh(path);
	}

	function copy(id: string) {
		navigator.clipboard?.writeText(linkFor(id)).catch(() => {});
		copiedId = id;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copiedId = null), 1500);
	}

	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={key} />

<div class="overlay" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onClose()}>
	<div class="modal" role="dialog" aria-label="Share note">
		<header>
			<span class="title">Share</span>
			<button class="ib" onclick={onClose} title="Close (Esc)">
				<span class="material-symbols-outlined">close</span>
			</button>
		</header>
		<p class="note-name">{path}</p>
		<p class="hint">Anyone with the link can view. Links show the note's current content and stop working when revoked, expired or the note is deleted.</p>

		{#if loading}
			<p class="state">Loading…</p>
		{:else if shares.length === 0}
			<p class="state">No links yet.</p>
		{:else}
			<ul class="links">
				{#each shares as s (s.id)}
					<li>
						<span class="material-symbols-outlined lock" title={s.hasPassword ? 'Password protected' : 'Open link'}>
							{s.hasPassword ? 'lock' : 'link'}
						</span>
						<span class="url" class:dead={expiryLabel(s.expiresAt) === 'expired'}>{linkFor(s.id)}</span>
						{#if s.expiresAt !== null}<span class="exp">{expiryLabel(s.expiresAt)}</span>{/if}
						<button class="ib" title={copiedId === s.id ? 'Copied' : 'Copy link'} onclick={() => copy(s.id)}>
							<span class="material-symbols-outlined">{copiedId === s.id ? 'check' : 'content_copy'}</span>
						</button>
						<button class="ib danger" title="Revoke link" onclick={() => void revoke(s.id)}>
							<span class="material-symbols-outlined">delete</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="new">
			<div class="opts">
				<label class="pwrow">
					<input type="checkbox" bind:checked={usePassword} />
					Password protect
				</label>
				<Select
					boxed
					value={String(lifetime)}
					options={SHARE_LIFETIMES.map((l) => ({ value: String(l.days), label: l.label }))}
					label="Link lifetime"
					onchange={(v) => (lifetime = v === 'null' ? null : Number(v))}
				/>
			</div>
			{#if usePassword}
				<input
					class="pw field"
					type="password"
					placeholder="Link password (4+ chars)"
					autocomplete="new-password"
					bind:value={password}
					disabled={creating}
					onkeydown={(e) => {
						if (e.key === 'Enter') void create();
					}}
				/>
			{/if}
			<button class="btn primary create" onclick={() => void create()} disabled={creating || (usePassword && password.length < 4)}>
				{creating ? 'Creating…' : 'Create new link'}
			</button>
		</div>
		{#if error}<p class="err">{error}</p>{/if}
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: var(--scrim);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 14vh;
	}
	.modal {
		width: min(480px, calc(100vw - 2rem));
		background: var(--menu);
		border-radius: var(--r-xl);
		box-shadow: var(--menu-shadow);
		padding: 14px 16px 16px;
		color: var(--text);
	}
	header {
		display: flex;
		align-items: center;
	}
	.title {
		flex: 1;
		font: 600 var(--fs-lg) var(--font-ui);
	}
	.note-name {
		margin: 2px 0 0;
		font-size: var(--t-meta);
		color: var(--text-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		margin: 8px 0 12px;
		font-size: var(--t-meta);
		color: var(--text-2);
	}
	.state {
		color: var(--text-3);
		font-size: var(--t-meta);
		margin: 8px 0;
	}
	.links {
		list-style: none;
		margin: 0 0 12px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.links li {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--inset);
		box-shadow: inset 0 0 0 1px var(--rim);
		border-radius: var(--r-md);
		padding: 3px 3px 3px 8px;
	}
	.lock {
		font-size: 16px;
		color: var(--text-3);
	}
	.url {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--t-meta);
		color: var(--text-2);
	}
	.url.dead {
		color: var(--text-4);
		text-decoration: line-through;
	}
	.exp {
		flex-shrink: 0;
		font-size: var(--t-caption);
		color: var(--text-3);
	}
	.ib {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.ib:hover {
		background: var(--hover);
		color: var(--text);
	}
	.ib.danger:hover {
		color: var(--red);
	}
	.ib .material-symbols-outlined {
		font-size: 17px;
	}
	.new {
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-top: 1px solid var(--line);
		padding-top: 12px;
	}
	.pwrow {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--t-meta);
		color: var(--text-2);
		cursor: pointer;
	}
	.opts {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.pw {
		height: 32px;
		padding: 0 10px;
		border: none;
		color: var(--text);
		font-size: var(--t-meta);
		outline: none;
	}
	.create {
		justify-content: center;
	}
	.err {
		color: var(--red);
		font-size: var(--t-meta);
		margin: 8px 0 0;
	}
</style>
