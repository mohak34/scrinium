<script lang="ts">
	import { activePath, linkUnlinkedMention } from '$lib/stores/vault';
	import { tree } from '$lib/stores/vault';
	import PanelSection from './PanelSection.svelte';

	interface Props {
		onSelect: (path: string) => void;
	}
	let { onSelect }: Props = $props();

	interface Backlink {
		path: string;
		excerpt: string;
	}

	let links = $state<Backlink[]>([]);
	let unlinked = $state<Backlink[]>([]);
	let loading = $state(false);
	let failed = $state(false);
	let linking = $state<string | null>(null);

	// Backlinks depend on other files, so refetch when the tree changes
	// (create/rename/delete/save) as well as when switching notes.
	$effect(() => {
		const current = $activePath;
		$tree;
		if (!current) {
			links = [];
			unlinked = [];
			failed = false;
			return;
		}
		loading = true;
		failed = false;
		let cancelled = false;
		fetch(`/api/backlinks?note=${encodeURIComponent(current)}`)
			.then((res) => {
				if (!res.ok) throw new Error('backlinks failed');
				return res.json();
			})
			.then((data: { linked: Backlink[]; unlinked: Backlink[] }) => {
				if (cancelled) return;
				links = Array.isArray(data.linked) ? data.linked : [];
				unlinked = Array.isArray(data.unlinked) ? data.unlinked : [];
			})
			.catch(() => {
				if (!cancelled) {
					links = [];
					unlinked = [];
					failed = true;
				}
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	async function link(path: string) {
		const target = $activePath;
		if (!target || linking) return;
		linking = path;
		try {
			await linkUnlinkedMention(path, target);
		} finally {
			linking = null;
		}
	}

	function nameOf(path: string): string {
		return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
	}

	function folderOf(path: string): string {
		const i = path.lastIndexOf('/');
		return i === -1 ? '' : path.slice(0, i).split('/').pop()!;
	}

	// Split an excerpt around mentions of the open note so they can be marked.
	function pieces(excerpt: string): { text: string; hit: boolean }[] {
		const name = $activePath ? nameOf($activePath) : '';
		if (!name) return [{ text: excerpt, hit: false }];
		const re = new RegExp(`(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return excerpt
			.split(re)
			.filter(Boolean)
			.map((text) => ({ text, hit: text.toLowerCase() === name.toLowerCase() }));
	}
</script>

{#snippet card(l: Backlink)}
	<button class="card" onclick={() => onSelect(l.path)} title={l.path}>
		<span class="head">
			<span class="material-symbols-outlined">description</span>
			<span class="name">{nameOf(l.path)}</span>
			{#if folderOf(l.path)}<span class="folder">{folderOf(l.path)}</span>{/if}
		</span>
		{#if l.excerpt}
			<span class="excerpt"
				>{#each pieces(l.excerpt) as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span
			>
		{/if}
	</button>
{/snippet}

{#if $activePath}
	<PanelSection icon="link" title="Linked notes" count={links.length}>
		{#if !loading && failed}
			<p class="empty">Could not load linked notes.</p>
		{:else if !loading && links.length === 0}
			<p class="empty">No notes link here yet.</p>
		{/if}
		{#each links as l (l.path)}
			{@render card(l)}
		{/each}
		{#if !loading && !failed && unlinked.length > 0}
			<div class="sub">Mentioned without a link</div>
			{#each unlinked as u (u.path)}
				<div class="unlinked">
					{@render card(u)}
					<button
						class="link-btn"
						disabled={linking === u.path}
						onclick={() => link(u.path)}
						title="Turn the mention into a [[link]]"
					>
						<span class="material-symbols-outlined">add_link</span>
						{linking === u.path ? 'Linking' : 'Link'}
					</button>
				</div>
			{/each}
		{/if}
	</PanelSection>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		margin: 6px 0;
		padding: 9px 11px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--raise);
		text-align: left;
		cursor: pointer;
	}
	.card:hover {
		border-color: var(--line-2);
		background: var(--hover);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: var(--text);
		font: 500 var(--fs) var(--font-ui);
	}
	.head .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.folder {
		margin-left: auto;
		padding-left: 8px;
		color: var(--text-3);
		font-size: var(--fs-xs);
		font-weight: 400;
		white-space: nowrap;
	}
	.excerpt {
		color: var(--text-2);
		font: var(--fs) / 1.55 var(--font-read);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	mark {
		background: var(--accent-dim);
		color: var(--accent);
		border-radius: 3px;
		padding: 0 2px;
	}
	.sub {
		margin: 12px 4px 0;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.unlinked {
		position: relative;
	}
	.unlinked .card {
		padding-bottom: 34px;
	}
	.link-btn {
		position: absolute;
		left: 10px;
		bottom: 8px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 8px 0 6px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-sm);
		background: var(--bg);
		color: var(--text-2);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.link-btn .material-symbols-outlined {
		font-size: 15px;
	}
	.link-btn:hover:not(:disabled) {
		color: var(--accent);
		border-color: var(--accent);
	}
	.link-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.empty {
		margin: 4px 4px 2px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
</style>
