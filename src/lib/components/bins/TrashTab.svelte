<script lang="ts">
	import { trashEntries, restoreTrash, purgeTrash, emptyTrash, type TrashEntry } from '$lib/stores/vault';
	import { groupByDate, when, longDate, split, kindIcon } from './lists';
	import NotePreview from './NotePreview.svelte';

	// Restoring a note opens it in a tab, so the view closes to show it.
	let { onOpened }: { onOpened: () => void } = $props();

	let filter = $state('');
	let selName = $state<string | null>(null);
	let busy = $state(false);

	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return $trashEntries.filter((e) => !q || e.originalPath.toLowerCase().includes(q));
	});
	const groups = $derived(groupByDate(shown, (e) => e.deletedAt));
	const sel = $derived(shown.find((e) => e.trashName === selName) ?? shown[0] ?? null);

	async function restore(e: TrashEntry) {
		busy = true;
		try {
			const path = await restoreTrash(e.trashName);
			if (path?.endsWith('.md')) onOpened();
		} finally {
			busy = false;
		}
	}

	async function purge(e: TrashEntry) {
		if (!confirm(`Delete "${e.originalPath}" forever?`)) return;
		busy = true;
		try {
			await purgeTrash(e.trashName);
		} finally {
			busy = false;
		}
	}

	async function empty() {
		if (!confirm(`Delete all ${$trashEntries.length} items in the trash forever? The archive is not touched.`))
			return;
		busy = true;
		try {
			await emptyTrash();
		} finally {
			busy = false;
		}
	}
</script>

<div class="panes">
	<div class="list">
		<div class="tools">
			<label class="filter">
				<span class="material-symbols-outlined">search</span>
				<input bind:value={filter} placeholder="Filter {$trashEntries.length} items" spellcheck="false" />
			</label>
			<button class="btn danger" disabled={!$trashEntries.length || busy} onclick={empty}>
				<span class="material-symbols-outlined">delete_forever</span>Empty
			</button>
		</div>
		<div class="rows">
			{#if $trashEntries.length === 0}
				<div class="empty">Trash is empty. Deleted notes land here and keep their old path.</div>
			{:else if groups.length === 0}
				<div class="empty">Nothing matches "{filter}".</div>
			{/if}
			{#each groups as g (g.label)}
				<div class="gh">{g.label}<span class="n">{g.items.length}</span></div>
				{#each g.items as e (e.trashName)}
					{@const p = split(e.originalPath)}
					<div
						class="row"
						class:on={sel?.trashName === e.trashName}
						role="button"
						tabindex="0"
						title={e.originalPath}
						onclick={() => (selName = e.trashName)}
						onkeydown={(ev) => ev.key === 'Enter' && (selName = e.trashName)}
					>
						<span class="material-symbols-outlined kind">{kindIcon(e.originalPath, e.isDir)}</span>
						<span class="txt">
							<span class="nm">{p.name}</span>
							<span class="dir">{p.dir || 'Vault root'}</span>
						</span>
						<span class="tm">{when(e.deletedAt)}</span>
						<span class="acts">
							<button
								class="ib"
								title="Restore"
								disabled={busy}
								onclick={(ev) => (ev.stopPropagation(), restore(e))}
							>
								<span class="material-symbols-outlined">undo</span>
							</button>
							<button
								class="ib del"
								title="Delete forever"
								disabled={busy}
								onclick={(ev) => (ev.stopPropagation(), purge(e))}
							>
								<span class="material-symbols-outlined">delete_forever</span>
							</button>
						</span>
					</div>
				{/each}
			{/each}
		</div>
	</div>

	<section class="view">
		{#if sel}
			<div class="vhead">
				<div class="txt">
					<h2>{split(sel.originalPath).name}</h2>
					<span class="meta">
						{split(sel.originalPath).dir || 'Vault root'} · deleted {longDate(sel.deletedAt)}
					</span>
				</div>
				<button class="btn danger" disabled={busy} onclick={() => purge(sel)}>
					<span class="material-symbols-outlined">delete_forever</span>Delete forever
				</button>
				<button class="btn primary" disabled={busy} onclick={() => restore(sel)}>
					<span class="material-symbols-outlined">undo</span>Restore
				</button>
			</div>
			<div class="vbody">
				{#if sel.isDir}
					<div class="empty">A folder. Restore it to open its notes.</div>
				{:else}
					<NotePreview path=".trash/{sel.trashName}" renderPath={sel.originalPath} />
				{/if}
			</div>
		{/if}
	</section>
</div>
