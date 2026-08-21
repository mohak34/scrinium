<script lang="ts">
	import { onMount } from 'svelte';
	import { trashEntries, loadTrash, restoreTrash, purgeTrash, emptyTrash } from '$lib/stores/vault';

	interface Props {
		onClose: () => void;
		onRestore?: (path: string) => void;
	}
	let { onClose, onRestore }: Props = $props();

	let busy = $state<string | null>(null);

	onMount(() => {
		loadTrash();
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
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
			if (restored && onRestore) onRestore(restored);
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

<div class="overlay" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onClose()}>
	<div class="panel" role="dialog" aria-label="Trash">
		<div class="head">
			<div class="title">
				<span class="material-symbols-outlined">delete</span>
				<span>Trash</span>
				<span class="count">{$trashEntries.length}</span>
			</div>
			<div class="head-actions">
				<button class="btn" disabled={!$trashEntries.length || busy === '__empty'} onclick={handleEmpty}>
					{busy === '__empty' ? 'Emptying…' : 'Empty trash'}
				</button>
				<button class="icon-btn" title="Close (Esc)" onclick={onClose}>
					<span class="material-symbols-outlined">close</span>
				</button>
			</div>
		</div>

		<div class="list">
			{#if $trashEntries.length === 0}
				<div class="empty">Trash is empty.</div>
			{:else}
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
							<button
								class="btn"
								disabled={busy !== null}
								onclick={() => handleRestore(entry)}
							>
								{busy === entry.trashName ? '…' : 'Restore'}
							</button>
							<button
								class="btn danger"
								disabled={busy !== null}
								onclick={() => handlePurge(entry)}
							>
								Delete
							</button>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 920;
		background: var(--overlay);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 8vh;
	}
	.panel {
		width: min(640px, 92vw);
		max-height: 72vh;
		display: flex;
		flex-direction: column;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--stack-gap);
		padding: 12px var(--panel-padding);
		border-bottom: 1px solid var(--border-default);
		flex-shrink: 0;
	}
	.title {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		font-size: var(--font-ui-medium);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
	}
	.count {
		background: var(--surface-container-high);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-micro);
		padding: 2px 6px;
		border-radius: var(--radius-full);
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
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
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 4px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-radius: var(--radius);
	}
	.row:hover {
		background: var(--surface-container-low);
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
	.hint {
		font-size: var(--font-ui-micro);
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
	.empty {
		padding: 24px;
		text-align: center;
		color: var(--outline);
		font-size: var(--font-ui-small);
	}
</style>
