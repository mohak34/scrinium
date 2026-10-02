<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { trashEntries, restoreTrash, purgeTrash, emptyTrash, type TrashEntry } from '$lib/stores/vault';

	// Restoring opens the note in a tab, so the dialog closes to show it.
	let { onRestored }: { onRestored: () => void } = $props();

	let filter = $state('');
	let busy = $state<string | null>(null);

	const DAY = 86400000;
	const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;

	function groupOf(at: number): (typeof GROUPS)[number] {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		if (!at) return 'Older';
		if (at >= today) return 'Today';
		if (at >= today - DAY) return 'Yesterday';
		if (at >= today - 7 * DAY) return 'Previous 7 days';
		return 'Older';
	}

	function when(at: number): string {
		if (!at) return '';
		const g = groupOf(at);
		const d = new Date(at);
		return g === 'Today' || g === 'Yesterday'
			? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			: d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	const split = (p: string) => {
		const i = p.lastIndexOf('/');
		return { name: p.slice(i + 1), dir: i < 0 ? '' : p.slice(0, i) };
	};

	const groups = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		const list = $trashEntries
			.filter((e) => !q || e.originalPath.toLowerCase().includes(q))
			.sort((a, b) => b.deletedAt - a.deletedAt);
		return GROUPS.map((label) => ({ label, items: list.filter((e) => groupOf(e.deletedAt) === label) })).filter(
			(g) => g.items.length
		);
	});

	const icon = (e: TrashEntry) =>
		e.isDir ? 'folder' : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(e.originalPath) ? 'image' : 'description';

	async function restore(e: TrashEntry) {
		busy = e.trashName;
		try {
			if (await restoreTrash(e.trashName)) {
				onRestored();
				if (page.url.pathname !== '/') await goto('/');
			}
		} finally {
			busy = null;
		}
	}

	async function purge(e: TrashEntry) {
		if (!confirm(`Delete "${e.originalPath}" forever?`)) return;
		busy = e.trashName;
		try {
			await purgeTrash(e.trashName);
		} finally {
			busy = null;
		}
	}

	async function empty() {
		if (!confirm(`Delete all ${$trashEntries.length} items forever?`)) return;
		busy = '*';
		try {
			await emptyTrash();
		} finally {
			busy = null;
		}
	}
</script>

<div class="tools">
	<label class="filter">
		<span class="material-symbols-outlined">search</span>
		<input bind:value={filter} placeholder="Filter {$trashEntries.length} items" spellcheck="false" />
	</label>
	<button class="btn danger" disabled={!$trashEntries.length || busy !== null} onclick={empty}>
		<span class="material-symbols-outlined">delete_forever</span>Empty trash
	</button>
</div>

{#if $trashEntries.length === 0}
	<div class="empty">Trash is empty. Deleted notes land here and keep their old path.</div>
{:else if groups.length === 0}
	<div class="empty">Nothing matches "{filter}".</div>
{:else}
	{#each groups as g (g.label)}
		<div class="gh">{g.label}<span class="n">{g.items.length}</span></div>
		{#each g.items as e (e.trashName)}
			{@const p = split(e.originalPath)}
			<div class="trow" title={e.originalPath}>
				<span class="material-symbols-outlined kind">{icon(e)}</span>
				<span class="nm">{p.name}</span>
				<span class="dir">{p.dir || 'Vault root'}</span>
				<span class="tm">{when(e.deletedAt)}</span>
				<span class="acts">
					<button class="ib" title="Restore" disabled={busy !== null} onclick={() => restore(e)}>
						<span class="material-symbols-outlined">undo</span>
					</button>
					<button class="ib del" title="Delete forever" disabled={busy !== null} onclick={() => purge(e)}>
						<span class="material-symbols-outlined">delete_forever</span>
					</button>
				</span>
			</div>
		{/each}
	{/each}
{/if}

<style>
	.tools {
		display: flex;
		gap: 8px;
		padding: 16px 0 4px;
	}
	.filter {
		flex: 1;
		height: 30px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		color: var(--text-3);
	}
	.filter:focus-within {
		border-color: var(--line-3);
	}
	.filter input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: none;
		color: var(--text);
		font: var(--fs-sm) var(--font-ui);
	}
	.gh {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 18px 10px 6px;
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text-2);
	}
	.n {
		color: var(--text-4);
		font: 11px var(--font-mono);
	}
	.trow {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr) minmax(0, 150px) 58px 64px;
		align-items: center;
		gap: 12px;
		height: 38px;
		padding: 0 10px;
		border-radius: var(--r);
	}
	.trow:hover,
	.trow:focus-within {
		background: var(--hover);
	}
	.kind {
		font-size: 17px;
		color: var(--text-3);
	}
	.nm,
	.dir {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dir {
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.tm {
		text-align: right;
		color: var(--text-3);
		font: 11.5px var(--font-mono);
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		gap: 2px;
		opacity: 0;
	}
	.trow:hover .acts,
	.trow:focus-within .acts {
		opacity: 1;
	}
	.ib {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.ib:hover:not(:disabled) {
		background: var(--press);
		color: var(--text);
	}
	.ib.del:hover:not(:disabled) {
		color: var(--red);
	}
</style>
