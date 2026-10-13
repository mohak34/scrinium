<script lang="ts">
	import { archivePath, deletePath, openTab, pinnedPaths } from '$lib/stores/vault';
	import type { ReviewNote } from '$lib/archive';
	import { longDate, split } from './lists';
	import NotePreview from './NotePreview.svelte';

	// Notes that look abandoned (old, nothing links to them, no task, no
	// share link, not pinned), to archive or trash in bulk.
	let { onOpened }: { onOpened: () => void } = $props();

	const SPANS = [30, 60, 90, 180, 365];
	let days = $state(60);
	let notes = $state<ReviewNote[]>([]);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let picked = $state<Set<string>>(new Set());
	let selPath = $state<string | null>(null);
	let busy = $state(false);

	$effect(() => {
		const d = days;
		let live = true;
		status = 'loading';
		void fetch(`/api/archive/review?days=${d}`)
			.then((r) => (r.ok ? (r.json() as Promise<ReviewNote[]>) : Promise.reject()))
			.then((list) => {
				if (!live) return;
				notes = list;
				picked = new Set();
				status = 'ready';
			})
			.catch(() => {
				if (live) status = 'error';
			});
		return () => {
			live = false;
		};
	});

	const shown = $derived(notes.filter((n) => !$pinnedPaths.includes(n.path)));
	const sel = $derived(shown.find((n) => n.path === selPath) ?? shown[0] ?? null);
	const allPicked = $derived(shown.length > 0 && shown.every((n) => picked.has(n.path)));

	function toggle(path: string) {
		const next = new Set(picked);
		if (!next.delete(path)) next.add(path);
		picked = next;
	}

	const toggleAll = () => (picked = allPicked ? new Set() : new Set(shown.map((n) => n.path)));

	// One at a time through the save queue; whatever moved leaves the list.
	async function bulk(move: (path: string) => Promise<boolean>, paths: string[]) {
		busy = true;
		try {
			const done = new Set<string>();
			for (const p of paths) if (await move(p)) done.add(p);
			notes = notes.filter((n) => !done.has(n.path));
			picked = new Set([...picked].filter((p) => !done.has(p)));
		} finally {
			busy = false;
		}
	}

	function trash(paths: string[]) {
		const what = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} notes`;
		if (confirm(`Move ${what} to the trash?`)) void bulk(deletePath, paths);
	}

	function open(path: string) {
		openTab(path);
		onOpened();
	}

	const ago = (at: number) => `${Math.floor((Date.now() - at) / 86400000)}d`;
</script>

<div class="panes">
	<div class="list">
		<div class="tools">
			<input type="checkbox" checked={allPicked} disabled={!shown.length} onchange={toggleAll} title="Select all" />
			<label class="span">
				Untouched for
				<select bind:value={days}>
					{#each SPANS as s (s)}<option value={s}>{s} days</option>{/each}
				</select>
			</label>
			<button class="btn" disabled={!picked.size || busy} onclick={() => bulk(archivePath, [...picked])}>
				<span class="material-symbols-outlined">inventory_2</span>Archive {picked.size || ''}
			</button>
			<button class="btn danger" disabled={!picked.size || busy} onclick={() => trash([...picked])}>
				<span class="material-symbols-outlined">delete</span>Trash
			</button>
		</div>
		<div class="rows">
			{#if status === 'loading'}
				<div class="empty">Looking for stale notes...</div>
			{:else if status === 'error'}
				<div class="empty">Could not load the review list.</div>
			{:else if shown.length === 0}
				<div class="empty">
					No stale notes. A note shows up here when it has not changed in {days} days and no note, task, pin or
					share link points at it.
				</div>
			{:else}
				<div class="gh">Oldest first<span class="n">{shown.length}</span></div>
			{/if}
			{#if status === 'ready'}
				{#each shown as n (n.path)}
					{@const p = split(n.path)}
					<div
						class="row"
						class:on={sel?.path === n.path}
						role="button"
						tabindex="0"
						title={n.path}
						onclick={() => (selPath = n.path)}
						onkeydown={(ev) => ev.key === 'Enter' && (selPath = n.path)}
					>
						<input
							type="checkbox"
							checked={picked.has(n.path)}
							onclick={(ev) => ev.stopPropagation()}
							onchange={() => toggle(n.path)}
						/>
						<span class="txt">
							<span class="nm">{n.title}</span>
							<span class="dir">{p.dir || 'Vault root'} · {n.words ? `${n.words} words` : 'empty'}</span>
						</span>
						<span class="tm" title="Last edited {longDate(n.updatedAt)}">{ago(n.updatedAt)}</span>
						<span class="acts">
							<button
								class="ib"
								title="Archive"
								disabled={busy}
								onclick={(ev) => (ev.stopPropagation(), bulk(archivePath, [n.path]))}
							>
								<span class="material-symbols-outlined">inventory_2</span>
							</button>
							<button
								class="ib del"
								title="Move to trash"
								disabled={busy}
								onclick={(ev) => (ev.stopPropagation(), trash([n.path]))}
							>
								<span class="material-symbols-outlined">delete</span>
							</button>
						</span>
					</div>
				{/each}
			{/if}
		</div>
	</div>

	<section class="view">
		{#if sel && status === 'ready'}
			<div class="vhead">
				<div class="txt">
					<h2>{sel.title}</h2>
					<span class="meta">{sel.path} · last edited {longDate(sel.updatedAt)}</span>
				</div>
				<button class="btn" onclick={() => open(sel.path)}>
					<span class="material-symbols-outlined">open_in_new</span>Open
				</button>
				<button class="btn danger" disabled={busy} onclick={() => trash([sel.path])}>
					<span class="material-symbols-outlined">delete</span>Trash
				</button>
				<button class="btn primary" disabled={busy} onclick={() => bulk(archivePath, [sel.path])}>
					<span class="material-symbols-outlined">inventory_2</span>Archive
				</button>
			</div>
			<div class="vbody"><NotePreview path={sel.path} /></div>
		{/if}
	</section>
</div>

<style>
	.span {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-3);
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	select {
		height: 28px;
		padding: 0 6px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: var(--panel);
		color: var(--text);
		font: var(--fs-sm) var(--font-ui);
	}
	input[type='checkbox'] {
		accent-color: var(--accent-fill);
		margin: 0 4px;
		flex-shrink: 0;
	}
</style>
