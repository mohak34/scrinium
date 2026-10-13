<script lang="ts">
	import { archiveEntries, unarchive, archiveToTrash, searchNotes } from '$lib/stores/vault';
	import { archivedNotePath, fromArchivedPath, type ArchiveEntry } from '$lib/archive';
	import { groupByDate, when, longDate, split, kindIcon } from './lists';
	import NotePreview from './NotePreview.svelte';

	// focus selects an item on open: the original path of a note inside it
	// (a wikilink to an archived note) or its ".archive/..." path (a task
	// link that followed it).
	let { focus, onOpened }: { focus?: string; onOpened: () => void } = $props();

	let filter = $state('');
	let hits = $state<Set<string>>(new Set());
	let selName = $state<string | null>(null);
	let selNote = $state<string | null>(null);
	let busy = $state(false);

	// The filter matches paths at once and note text through the archive's
	// full-text index once it settles.
	$effect(() => {
		const q = filter.trim();
		if (q.length < 2) {
			hits = new Set();
			return;
		}
		let live = true;
		const t = setTimeout(async () => {
			const found = await searchNotes(q, 'archive');
			if (!live) return;
			const entries = $archiveEntries;
			hits = new Set(found.flatMap((h) => fromArchivedPath(entries, h.path)?.entry.name ?? []));
		}, 200);
		return () => {
			live = false;
			clearTimeout(t);
		};
	});

	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return $archiveEntries.filter((e) => !q || e.originalPath.toLowerCase().includes(q) || hits.has(e.name));
	});
	const groups = $derived(groupByDate(shown, (e) => e.archivedAt));

	// Focus waits for the list to load, then applies once.
	let applied: string | undefined;
	$effect(() => {
		const f = focus;
		if (!f || f === applied) return;
		const binned = fromArchivedPath($archiveEntries, f);
		const e = binned?.entry ?? $archiveEntries.find((x) => x.notes.includes(f));
		if (!e) return;
		const n = binned?.note ?? f;
		applied = f;
		selName = e.name;
		selNote = e.notes.includes(n) ? n : null;
	});

	const sel = $derived(shown.find((e) => e.name === selName) ?? shown[0] ?? null);
	const note = $derived(sel && (selNote && sel.notes.includes(selNote) ? selNote : sel.notes[0]) || null);

	function pick(e: ArchiveEntry) {
		selName = e.name;
		selNote = null;
	}

	async function restore(e: ArchiveEntry) {
		busy = true;
		try {
			const path = await unarchive(e.name);
			if (path?.endsWith('.md')) onOpened();
		} finally {
			busy = false;
		}
	}

	async function trash(e: ArchiveEntry) {
		busy = true;
		try {
			await archiveToTrash(e.name);
		} finally {
			busy = false;
		}
	}

	const inner = (e: ArchiveEntry, n: string) => n.slice(e.originalPath.length + 1);
</script>

<div class="panes">
	<div class="list">
		<div class="tools">
			<label class="filter">
				<span class="material-symbols-outlined">search</span>
				<input bind:value={filter} placeholder="Search {$archiveEntries.length} archived" spellcheck="false" />
			</label>
		</div>
		<div class="rows">
			{#if $archiveEntries.length === 0}
				<div class="empty">
					Nothing archived. Archive a note from its menu or the Review tab; it leaves the tree and normal
					search but stays here, searchable, until you bring it back.
				</div>
			{:else if groups.length === 0}
				<div class="empty">Nothing matches "{filter}".</div>
			{/if}
			{#each groups as g (g.label)}
				<div class="gh">{g.label}<span class="n">{g.items.length}</span></div>
				{#each g.items as e (e.name)}
					{@const p = split(e.originalPath)}
					<div
						class="row"
						class:on={sel?.name === e.name}
						role="button"
						tabindex="0"
						title={e.originalPath}
						onclick={() => pick(e)}
						onkeydown={(ev) => ev.key === 'Enter' && pick(e)}
					>
						<span class="material-symbols-outlined kind">{kindIcon(e.originalPath, e.isDir)}</span>
						<span class="txt">
							<span class="nm">{e.isDir ? p.name : p.name.replace(/\.md$/, '')}</span>
							<span class="dir">
								{p.dir || 'Vault root'}{e.isDir ? ` · ${e.notes.length} notes` : ''}
							</span>
						</span>
						<span class="tm">{when(e.archivedAt)}</span>
						<span class="acts">
							<button
								class="ib"
								title="Unarchive"
								disabled={busy}
								onclick={(ev) => (ev.stopPropagation(), restore(e))}
							>
								<span class="material-symbols-outlined">unarchive</span>
							</button>
							<button
								class="ib del"
								title="Move to trash"
								disabled={busy}
								onclick={(ev) => (ev.stopPropagation(), trash(e))}
							>
								<span class="material-symbols-outlined">delete</span>
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
					<h2>{split(sel.originalPath).name.replace(/\.md$/, '')}</h2>
					<span class="meta">
						{split(sel.originalPath).dir || 'Vault root'} · archived {longDate(sel.archivedAt)}
					</span>
				</div>
				<button class="btn danger" disabled={busy} onclick={() => trash(sel)}>
					<span class="material-symbols-outlined">delete</span>Move to trash
				</button>
				<button class="btn primary" disabled={busy} onclick={() => restore(sel)}>
					<span class="material-symbols-outlined">unarchive</span>Unarchive
				</button>
			</div>
			<div class="vbody">
				{#if sel.isDir}
					<div class="inside">
						{#each sel.notes as n (n)}
							<button class="chip" class:on={n === note} onclick={() => (selNote = n)}>
								{inner(sel, n).replace(/\.md$/, '')}
							</button>
						{/each}
					</div>
				{/if}
				{#if note}
					<!-- A folder's images moved with it; a lone note's stayed in the vault. -->
					<NotePreview
						path={archivedNotePath(sel, note)}
						renderPath={sel.isDir ? archivedNotePath(sel, note) : note}
					/>
				{:else if !sel.isDir}
					<NotePreview path=".archive/{sel.name}" renderPath={sel.originalPath} />
				{:else}
					<div class="empty">This folder has no notes.</div>
				{/if}
			</div>
		{/if}
	</section>
</div>
