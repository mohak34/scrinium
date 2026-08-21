<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { trashEntries, loadTrash, restoreTrash, purgeTrash, emptyTrash } from '$lib/stores/vault';

	let busy = $state<string | null>(null);

	onMount(() => {
		loadTrash();
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') goto('/');
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
	});

	function formatDate(ms: number) {
		if (!ms) return '—';
		try {
			return new Date(ms).toLocaleString();
		} catch {
			return String(ms);
		}
	}

	async function handleRestore(entry: { trashName: string }) {
		busy = entry.trashName;
		try {
			const restored = await restoreTrash(entry.trashName);
			if (restored) goto('/');
		} finally {
			busy = null;
		}
	}

	async function handlePurge(entry: { trashName: string }) {
		if (!confirm('Permanently delete this item?')) return;
		busy = entry.trashName;
		try {
			await purgeTrash(entry.trashName);
		} finally {
			busy = null;
		}
	}

	async function handleEmpty() {
		if (!confirm('Permanently delete everything in trash?')) return;
		busy = '__empty';
		try {
			await emptyTrash();
		} finally {
			busy = null;
		}
	}
</script>

<div class="page">
	<header class="topbar">
		<div class="left">
			<button class="icon-btn" onclick={() => goto('/')} title="Back to vault (Esc)">
				<span class="material-symbols-outlined">arrow_back</span>
			</button>
			<span class="title">Trash</span>
			<span class="count">{$trashEntries.length}</span>
		</div>
		<div class="right">
			<button class="btn" disabled={!$trashEntries.length || busy === '__empty'} onclick={handleEmpty}>
				{busy === '__empty' ? 'Emptying…' : 'Empty trash'}
			</button>
		</div>
	</header>

	<div class="scroll">
		<div class="content">
			{#if $trashEntries.length === 0}
				<div class="empty">Trash is empty. Deleted notes and folders will appear here.</div>
			{:else}
				<div class="hint">Deleted items are kept in <code>.trash</code> until you empty them.</div>
				<div class="list">
					{#each $trashEntries as entry (entry.trashName)}
						<div class="row">
							<div class="meta">
								<span class="name" title={entry.originalPath}>
									<span class="material-symbols-outlined row-icon">{entry.isDir ? 'folder' : 'description'}</span>
									{entry.originalPath}
								</span>
								<span class="hint">
									deleted {formatDate(entry.deletedAt)}
									{#if entry.size !== undefined} · {entry.size} bytes{/if}
								</span>
								<span class="trash-name mono">{entry.trashName}</span>
							</div>
							<div class="actions">
								<button class="btn" disabled={busy !== null} onclick={() => handleRestore(entry)}>
									{busy === entry.trashName ? '…' : 'Restore'}
								</button>
								<button class="btn danger" disabled={busy !== null} onclick={() => handlePurge(entry)}>
									Delete
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--background);
		color: var(--on-surface);
		font-family: var(--font-ui);
	}
	.topbar {
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--stack-gap);
		padding: 0 var(--gutter);
		border-bottom: 1px solid var(--border-default);
		flex-shrink: 0;
		background: var(--background);
	}
	.left {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		min-width: 0;
	}
	.right {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
	}
	.title {
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		font-weight: var(--font-editor-title-weight);
		letter-spacing: var(--font-editor-title-tracking);
		color: var(--on-surface);
	}
	.count {
		background: var(--surface-container-high);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-micro);
		padding: 2px 6px;
		border-radius: var(--radius-full);
	}
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface-variant);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.btn {
		height: 28px;
		padding: 0 10px;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
		white-space: nowrap;
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.danger {
		color: var(--error);
	}
	.btn.danger:hover:not(:disabled) {
		background: var(--error-container);
		color: var(--on-error-container);
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.content {
		max-width: var(--editor-max-width);
		margin: 0 auto;
		width: 100%;
		padding: 20px var(--gutter) 48px;
	}
	.hint {
		font-size: var(--font-ui-micro);
		color: var(--outline);
		margin-bottom: 12px;
	}
	.empty {
		padding: 32px 0;
		text-align: center;
		color: var(--outline);
		font-size: var(--font-ui-small);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		background: var(--surface-container);
	}
	.row:hover {
		border-color: var(--border-raised);
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--font-ui-small);
		color: var(--on-surface);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.row-icon {
		font-size: 16px;
		color: var(--outline);
	}
	.trash-name.mono {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--outline);
		opacity: 0.7;
	}
	.actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		background: var(--surface-container-high);
		padding: 0.1em 0.3em;
		border-radius: 4px;
	}
</style>
