<script lang="ts">
	import { deletePath, flushSave } from '$lib/stores/vault';
	import type { UnusedFile } from '$lib/archive';
	import { kindIcon, longDate, split } from './lists';
	import NotePreview from './NotePreview.svelte';

	// Vault files no note links to (images left behind by trashed notes and
	// deleted embeds), to trash in bulk.
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let files = $state<UnusedFile[]>([]);
	let picked = $state<Set<string>>(new Set());
	let selPath = $state<string | null>(null);
	let busy = $state(false);

	// The scan reads saved notes, so unsaved text (a just-pasted embed) is
	// written first; a failed save means the list could be wrong.
	async function load(): Promise<UnusedFile[]> {
		if (!(await flushSave())) throw new Error('unsaved notes');
		const r = await fetch('/api/archive/unused');
		if (!r.ok) throw new Error('scan failed');
		return r.json();
	}

	$effect(() => {
		let live = true;
		load()
			.then((list) => {
				if (!live) return;
				files = list;
				status = 'ready';
			})
			.catch(() => {
				if (live) status = 'error';
			});
		return () => {
			live = false;
		};
	});

	const sel = $derived(files.find((f) => f.path === selPath) ?? files[0] ?? null);
	const allPicked = $derived(files.length > 0 && files.every((f) => picked.has(f.path)));
	const total = $derived(files.reduce((n, f) => n + f.size, 0));

	function toggle(path: string) {
		const next = new Set(picked);
		if (!next.delete(path)) next.add(path);
		picked = next;
	}

	const toggleAll = () => (picked = allPicked ? new Set() : new Set(files.map((f) => f.path)));

	// One at a time through the save queue. The list is scanned again first,
	// so a file a note started using since it loaded is never trashed.
	async function trash(paths: string[]) {
		const what = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} files`;
		if (!confirm(`Move ${what} to the trash?`)) return;
		busy = true;
		try {
			try {
				files = await load();
			} catch {
				status = 'error';
				return;
			}
			const unused = new Set(files.map((f) => f.path));
			for (const p of paths) if (unused.has(p) && (await deletePath(p))) unused.delete(p);
			files = files.filter((f) => unused.has(f.path));
			picked = new Set([...picked].filter((p) => unused.has(p)));
		} finally {
			busy = false;
		}
	}

	function bytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<div class="panes">
	<div class="list">
		<div class="tools">
			<input type="checkbox" checked={allPicked} disabled={!files.length} onchange={toggleAll} title="Select all" />
			<span class="sum">{files.length ? `${files.length} files · ${bytes(total)}` : ''}</span>
			<button class="btn danger" disabled={!picked.size || busy} onclick={() => trash([...picked])}>
				<span class="material-symbols-outlined">delete</span>Trash {picked.size || ''}
			</button>
		</div>
		<div class="rows">
			{#if status === 'loading'}
				<div class="empty">Looking for unused files...</div>
			{:else if status === 'error'}
				<div class="empty">Could not load the list.</div>
			{:else if files.length === 0}
				<div class="empty">No unused files. A file shows up here when no note, archived ones included, links to it.</div>
			{/if}
			{#each files as f (f.path)}
				{@const p = split(f.path)}
				<div
					class="row"
					class:on={sel?.path === f.path}
					role="button"
					tabindex="0"
					title={f.path}
					onclick={() => (selPath = f.path)}
					onkeydown={(ev) => ev.key === 'Enter' && (selPath = f.path)}
				>
					<input
						type="checkbox"
						checked={picked.has(f.path)}
						onclick={(ev) => ev.stopPropagation()}
						onchange={() => toggle(f.path)}
					/>
					<span class="material-symbols-outlined kind">{kindIcon(f.path, false)}</span>
					<span class="txt">
						<span class="nm">{p.name}</span>
						<span class="dir">{p.dir || 'Vault root'} · {bytes(f.size)}</span>
					</span>
					<span class="acts">
						<button
							class="ib del"
							title="Move to trash"
							disabled={busy}
							onclick={(ev) => (ev.stopPropagation(), trash([f.path]))}
						>
							<span class="material-symbols-outlined">delete</span>
						</button>
					</span>
				</div>
			{/each}
		</div>
	</div>

	<section class="view">
		{#if sel}
			<div class="vhead">
				<div class="txt">
					<h2>{split(sel.path).name}</h2>
					<span class="meta">{sel.path} · {bytes(sel.size)} · modified {longDate(sel.modifiedAt)}</span>
				</div>
				<button class="btn danger" disabled={busy} onclick={() => trash([sel.path])}>
					<span class="material-symbols-outlined">delete</span>Trash
				</button>
			</div>
			<div class="vbody"><NotePreview path={sel.path} /></div>
		{/if}
	</section>
</div>

<style>
	.sum {
		flex: 1;
		color: var(--text-3);
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	input[type='checkbox'] {
		accent-color: var(--accent-fill);
		margin: 0 4px;
		flex-shrink: 0;
	}
</style>
