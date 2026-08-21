<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		trashEntries,
		loadTrash,
		restoreTrash,
		purgeTrash,
		emptyTrash,
		type TrashEntry
	} from '$lib/stores/vault';

	let busy = $state<string | null>(null);

	onMount(() => {
		loadTrash();
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') goto('/');
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
	});

	type GroupKey = 'today' | 'yesterday' | 'week' | 'older';

	const GROUP_ORDER: { key: GroupKey; label: string }[] = [
		{ key: 'today', label: 'Today' },
		{ key: 'yesterday', label: 'Yesterday' },
		{ key: 'week', label: 'Previous 7 days' },
		{ key: 'older', label: 'Older' }
	];

	function groupOf(deletedAt: number): GroupKey {
		if (!deletedAt) return 'older';
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const day = 24 * 60 * 60 * 1000;
		if (deletedAt >= startOfToday) return 'today';
		if (deletedAt >= startOfToday - day) return 'yesterday';
		if (deletedAt >= startOfToday - 7 * day) return 'week';
		return 'older';
	}

	function timeLabel(entry: TrashEntry): string {
		if (!entry.deletedAt) return '—';
		try {
			const d = new Date(entry.deletedAt);
			const g = groupOf(entry.deletedAt);
			if (g === 'today' || g === 'yesterday') {
				return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			}
			return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
		} catch {
			return String(entry.deletedAt);
		}
	}

	const groups = $derived.by(() => {
		const sorted = [...$trashEntries].sort((a, b) => b.deletedAt - a.deletedAt);
		return GROUP_ORDER.map((g) => ({
			...g,
			entries: sorted.filter((e) => groupOf(e.deletedAt) === g.key)
		})).filter((g) => g.entries.length > 0);
	});

	async function handleRestore(entry: TrashEntry) {
		busy = entry.trashName;
		try {
			const restored = await restoreTrash(entry.trashName);
			if (restored) goto('/');
		} finally {
			busy = null;
		}
	}

	async function handlePurge(entry: TrashEntry) {
		if (!confirm(`Permanently delete "${entry.originalPath}"?`)) return;
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
		</div>
		<button class="btn" disabled={!$trashEntries.length || busy === '__empty'} onclick={handleEmpty}>
			{busy === '__empty' ? 'Emptying…' : 'Empty trash'}
		</button>
	</header>

	<div class="scroll">
		<div class="content">
			{#if $trashEntries.length === 0}
				<div class="empty">Trash is empty.</div>
			{:else}
				{#each groups as group (group.key)}
					<section class="group">
						<div class="ghead">
							<span class="glabel">{group.label}</span>
							<span class="gcount">{group.entries.length}</span>
						</div>
						{#each group.entries as entry (entry.trashName)}
							<div class="row">
								<span class="material-symbols-outlined row-icon">{entry.isDir ? 'folder' : 'description'}</span>
								<span class="meta" title={entry.originalPath}>
									<span class="n">{entry.originalPath.split('/').pop()}</span>
									<span class="p">
										{entry.originalPath.includes('/')
											? entry.originalPath.slice(0, entry.originalPath.lastIndexOf('/'))
											: '(vault root)'}
									</span>
								</span>
								<span class="when">{timeLabel(entry)}</span>
								<span class="acts">
									<button
										class="abtn"
										title="Restore"
										disabled={busy !== null}
										onclick={() => handleRestore(entry)}
									>
										<span class="material-symbols-outlined">undo</span>
									</button>
									<button
										class="abtn del"
										title="Delete forever"
										disabled={busy !== null}
										onclick={() => handlePurge(entry)}
									>
										<span class="material-symbols-outlined">delete_forever</span>
									</button>
								</span>
							</div>
						{/each}
					</section>
				{/each}
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
	.title {
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		font-weight: var(--font-editor-title-weight);
		letter-spacing: var(--font-editor-title-tracking);
		color: var(--on-surface);
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
		padding: 0;
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
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.content {
		max-width: 640px;
		margin: 0 auto;
		width: 100%;
		padding: 20px var(--gutter) 48px;
	}
	.empty {
		padding: 32px 0;
		text-align: center;
		color: var(--outline);
		font-size: var(--font-ui-small);
	}
	.group {
		margin-bottom: 26px;
	}
	.ghead {
		display: flex;
		align-items: baseline;
		gap: var(--stack-gap);
		padding-bottom: 6px;
		border-bottom: 1px solid var(--border-default);
	}
	.glabel {
		font-size: var(--font-label-caps);
		line-height: var(--font-label-caps-lh);
		font-weight: var(--font-label-caps-weight);
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--outline);
	}
	.gcount {
		font-size: var(--font-label-caps);
		color: var(--outline-variant);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 6px;
		border-radius: var(--radius);
		border-bottom: 1px solid var(--border-default);
	}
	.row:last-child {
		border-bottom: none;
	}
	.row:hover {
		background: var(--surface-container-low);
	}
	.row-icon {
		flex-shrink: 0;
		font-size: 16px;
		color: var(--outline);
		opacity: 0.7;
	}
	.meta {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.n {
		color: var(--on-surface);
		font-size: var(--font-ui-small);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.p {
		color: var(--outline-variant);
		font-size: var(--font-ui-micro);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.when {
		color: var(--dim, var(--outline));
		font-size: var(--font-ui-micro);
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	.acts {
		display: none;
		gap: 2px;
		flex-shrink: 0;
	}
	.row:hover .acts {
		display: flex;
	}
	.row:hover .when {
		display: none;
	}
	.abtn {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--on-surface-variant);
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
	}
	.abtn .material-symbols-outlined {
		font-size: 16px;
	}
	.abtn:hover:not(:disabled) {
		background: var(--surface-container-high);
		color: var(--primary);
	}
	.abtn.del:hover:not(:disabled) {
		color: var(--error);
	}
	.abtn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
