<script lang="ts">
	import { tick } from 'svelte';
	import { restoreVersion } from '$lib/stores/vault';
	import { lineDiff, type DiffLine } from '$lib/lineDiff';
	import { groupByDate, when, split } from './bins/lists';

	// Full-page history of the open note: versions on the left (who wrote
	// each, and when), the selected one diffed against the note's live text
	// on the right. Restore puts that version back as a new write.
	let { path, current, onClose }: { path: string; current: string; onClose: () => void } = $props();

	interface Version {
		id: number;
		author: string | null;
		created_at: number;
		at: number;
		size: number;
		mine: boolean;
	}

	let root = $state<HTMLDivElement>();
	let versions = $state<Version[] | null>(null);
	let failed = $state(false);
	let selId = $state<number | null>(null);
	let texts = $state<Record<number, string>>({});
	let busy = $state(false);

	const q = (extra = '') => `/api/history?note=${encodeURIComponent(path)}${extra}`;
	const sel = $derived(versions?.find((v) => v.id === selId) ?? versions?.[0] ?? null);
	const groups = $derived(groupByDate(versions ?? [], (v) => v.at));
	const text = $derived(sel ? texts[sel.id] : undefined);
	// The version into the current text: `del` lines are what a restore
	// brings back, `add` lines what it takes out.
	const diff = $derived(text === undefined ? null : lineDiff(text, current));
	const changed = $derived(diff?.some((l) => l.kind !== 'same') ?? false);

	const who = (v: Version) => (v.mine ? 'You' : (v.author ?? 'Unattributed'));
	const icon = (v: Version) => (v.author === null ? 'help' : v.mine || v.author.includes('@') ? 'person' : 'smart_toy');
	const stamp = (at: number) =>
		new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

	// Unchanged runs fold to 3 lines of context on each side.
	const CONTEXT = 3;
	type Hunk = { fold: number } | DiffLine;
	const hunks = $derived.by(() => {
		if (!diff) return [];
		const out: Hunk[] = [];
		let i = 0;
		while (i < diff.length) {
			if (diff[i].kind !== 'same') {
				out.push(diff[i++]);
				continue;
			}
			let j = i;
			while (j < diff.length && diff[j].kind === 'same') j++;
			const keepHead = i === 0 ? 0 : CONTEXT;
			const keepTail = j === diff.length ? 0 : CONTEXT;
			if (j - i > keepHead + keepTail + 1) {
				out.push(...diff.slice(i, i + keepHead), { fold: j - i - keepHead - keepTail }, ...diff.slice(j - keepTail, j));
			} else out.push(...diff.slice(i, j));
			i = j;
		}
		return out;
	});

	$effect(() => {
		void fetch(q())
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((list: Version[]) => (versions = list))
			.catch(() => (failed = true));
	});

	$effect(() => {
		const v = sel;
		if (!v || texts[v.id] !== undefined) return;
		void fetch(q(`&id=${v.id}`))
			.then((r) => (r.ok ? r.text() : Promise.reject()))
			.then((t) => (texts[v.id] = t))
			.catch(() => (failed = true));
	});

	$effect(() => {
		const prev = document.activeElement as HTMLElement | null;
		void tick().then(() => root?.focus());
		// Modal like the bins view: app shortcuts never fire underneath.
		const onKey = (e: KeyboardEvent) => {
			e.stopPropagation();
			if (e.key === 'Escape') {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			prev?.focus?.();
		};
	});

	async function restore() {
		if (text === undefined) return;
		busy = true;
		try {
			if (await restoreVersion(path, text)) onClose();
		} finally {
			busy = false;
		}
	}
</script>

<div class="hist" role="dialog" aria-modal="true" aria-label="Note history" tabindex="-1" bind:this={root}>
	<header>
		<span class="material-symbols-outlined">history</span>
		<span class="title">History</span>
		<span class="note">{split(path).name.replace(/\.md$/i, '')}</span>
		<span class="kbd">Esc</span>
		<button class="ib" title="Close" onclick={onClose}>
			<span class="material-symbols-outlined">close</span>
		</button>
	</header>
	<div class="panes">
		<div class="list">
			{#if failed}
				<div class="empty">Could not load the history.</div>
			{:else if versions && versions.length === 0}
				<div class="empty">No versions yet. Every save from here on, yours or an agent's, is kept.</div>
			{/if}
			{#each groups as g (g.label)}
				<div class="gh">{g.label}<span class="n">{g.items.length}</span></div>
				{#each g.items as v (v.id)}
					<button class="row" class:on={sel?.id === v.id} onclick={() => (selId = v.id)}>
						<span class="material-symbols-outlined kind">{icon(v)}</span>
						<span class="nm">{who(v)}</span>
						<span class="tm">{when(v.at)}</span>
					</button>
				{/each}
			{/each}
		</div>
		<section class="view">
			{#if sel}
				<div class="vhead">
					<div class="txt">
						<h2>{who(sel)}</h2>
						<span class="meta">
							{sel.created_at === sel.at ? stamp(sel.at) : `${stamp(sel.created_at)} to ${stamp(sel.at)}`}
							{#if diff}
								· {changed ? 'differs from the current note' : 'same as the current note'}
							{/if}
						</span>
					</div>
					<button class="btn primary" disabled={busy || !changed} onclick={restore}>
						<span class="material-symbols-outlined">restore</span>Restore
					</button>
				</div>
				<div class="vbody">
					{#if diff && !changed}
						<div class="empty">No differences from the current note.</div>
					{:else}
						<pre class="diff">{#each hunks as h, i (i)}{#if 'fold' in h}<span class="fold"
										>{h.fold} unchanged lines</span
									>{:else}<span class={h.kind}>{h.text || ' '}</span>{/if}{/each}</pre>
					{/if}
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.hist {
		position: fixed;
		inset: 0;
		z-index: 940;
		background: var(--bg);
		display: flex;
		flex-direction: column;
		outline: none;
		font-family: var(--font-ui);
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 48px;
		flex-shrink: 0;
		padding: 0 12px 0 20px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}
	header > .material-symbols-outlined {
		font-size: 18px;
		color: var(--accent);
	}
	.title {
		font-size: var(--fs);
		color: var(--text);
	}
	.note {
		flex: 1;
		min-width: 0;
		color: var(--text-3);
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kbd {
		color: var(--text-4);
		font: 11px var(--font-mono);
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
	.ib:hover {
		background: var(--press);
		color: var(--text);
	}
	.panes {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.list {
		width: 320px;
		flex-shrink: 0;
		overflow-y: auto;
		padding: 0 8px 16px;
		border-right: 1px solid var(--line);
		background: var(--panel);
	}
	.gh {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 14px 8px 6px;
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text-2);
	}
	.gh .n,
	.tm {
		color: var(--text-4);
		font: 11px var(--font-mono);
	}
	.tm {
		color: var(--text-3);
		white-space: nowrap;
	}
	.row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		height: 36px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		background: var(--hover);
	}
	.row.on {
		background: var(--accent-dim);
	}
	.kind {
		font-size: 18px;
		color: var(--text-3);
	}
	.nm {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.empty {
		padding: 28px 8px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.view {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.vhead {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		padding: 10px 32px;
		border-bottom: 1px solid var(--line);
	}
	.vhead .txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.vhead h2 {
		margin: 0;
		font: 600 var(--fs-lg) var(--font-ui);
	}
	.meta {
		font-size: var(--fs-sm);
		color: var(--text-3);
	}
	.btn {
		height: 28px;
		padding: 0 11px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--accent-fill);
		border-radius: var(--r);
		background: var(--accent-fill);
		color: var(--on-accent);
		font: var(--fs-sm) var(--font-ui);
		cursor: pointer;
	}
	.btn .material-symbols-outlined {
		font-size: 16px;
	}
	.btn:hover:not(:disabled) {
		background: var(--accent-fill-hi);
		border-color: var(--accent-fill-hi);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.vbody {
		flex: 1;
		overflow: auto;
		padding: 12px 32px;
	}
	.diff {
		margin: 0;
		font: var(--fs-sm) / 1.6 var(--font-mono);
		color: var(--text-2);
	}
	.diff span {
		display: block;
		padding: 0 8px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	/* In the version, gone now: a restore brings it back. */
	.diff .del {
		color: var(--red);
		background: color-mix(in srgb, var(--red) 10%, transparent);
	}
	.diff .del::before {
		content: '- ';
	}
	/* In the note now, not in the version. */
	.diff .add {
		color: var(--green);
		background: color-mix(in srgb, var(--green) 10%, transparent);
	}
	.diff .add::before {
		content: '+ ';
	}
	.diff .same::before {
		content: '  ';
	}
	.diff .fold {
		color: var(--text-4);
		padding: 4px 8px;
	}
</style>
