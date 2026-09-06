<script lang="ts">
	import { activePath } from '$lib/stores/vault';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	interface Share {
		id: string;
		notePath: string;
		createdAt: number;
		hasPassword: boolean;
	}

	let shares = $state<Share[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let usePassword = $state(false);
	let password = $state('');
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
				body: JSON.stringify({ path, password: usePassword ? password : undefined })
			});
			if (!res.ok) {
				error = res.status === 404 ? 'Note has unsaved changes - wait a moment and retry.' : 'Could not create link.';
				return;
			}
			password = '';
			usePassword = false;
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
			<button class="x" onclick={onClose} title="Close (Esc)">
				<span class="material-symbols-outlined">close</span>
			</button>
		</header>
		<p class="note-name">{path}</p>
		<p class="hint">Anyone with the link can view. Links show the note's current content and stop working when revoked or the note is deleted.</p>

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
						<span class="url">{linkFor(s.id)}</span>
						<button class="btn" title={copiedId === s.id ? 'Copied' : 'Copy link'} onclick={() => copy(s.id)}>
							<span class="material-symbols-outlined">{copiedId === s.id ? 'check' : 'content_copy'}</span>
						</button>
						<button class="btn danger" title="Revoke link" onclick={() => void revoke(s.id)}>
							<span class="material-symbols-outlined">delete</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="new">
			<label class="pwrow">
				<input type="checkbox" bind:checked={usePassword} />
				Password protect
			</label>
			{#if usePassword}
				<input
					class="pw"
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
			<button class="create" onclick={() => void create()} disabled={creating || (usePassword && password.length < 4)}>
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
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 14vh;
	}
	.modal {
		width: min(480px, calc(100vw - 2rem));
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		padding: 1rem 1.1rem 1.1rem;
		color: var(--on-surface);
	}
	header {
		display: flex;
		align-items: center;
	}
	.title {
		flex: 1;
		font-weight: 600;
	}
	.x {
		display: flex;
		border: none;
		background: none;
		color: var(--outline);
		cursor: pointer;
		border-radius: var(--radius);
		padding: 2px;
	}
	.x:hover {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.note-name {
		margin: 0.25rem 0 0;
		font-size: var(--font-ui-small);
		color: var(--outline);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		margin: 0.5rem 0 0.75rem;
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
	}
	.state {
		color: var(--outline);
		font-size: var(--font-ui-small);
		margin: 0.5rem 0;
	}
	.links {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.links li {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--surface-container-low);
		border-radius: var(--radius);
		padding: 4px 4px 4px 8px;
	}
	.lock {
		font-size: 16px;
		color: var(--outline);
		flex-shrink: 0;
	}
	.url {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-ui-small);
		font-family: var(--font-mono);
	}
	.btn {
		display: flex;
		border: none;
		background: none;
		color: var(--outline);
		cursor: pointer;
		border-radius: var(--radius);
		padding: 4px;
	}
	.btn:hover {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.btn.danger:hover {
		color: var(--error);
	}
	.btn .material-symbols-outlined {
		font-size: 17px;
	}
	.new {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--border-default);
		padding-top: 0.75rem;
	}
	.pwrow {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		cursor: pointer;
	}
	.pw {
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface);
		font-size: var(--font-ui-small);
		padding: 6px 8px;
		outline: none;
	}
	.pw:focus {
		border-color: var(--primary);
	}
	.create {
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface);
		font-size: var(--font-ui-small);
		font-weight: 600;
		padding: 7px;
		cursor: pointer;
	}
	.create:hover:not(:disabled) {
		background: var(--surface-container-low);
	}
	.create:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.err {
		color: var(--error);
		font-size: var(--font-ui-small);
		margin: 0.5rem 0 0;
	}
</style>
