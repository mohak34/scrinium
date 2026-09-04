<script lang="ts">
	import { activePath } from '$lib/stores/vault';
	import { tree } from '$lib/stores/vault';

	interface Props {
		onSelect: (path: string) => void;
	}
	let { onSelect }: Props = $props();

	interface Backlink {
		path: string;
		excerpt: string;
	}

	let links = $state<Backlink[]>([]);
	let loading = $state(false);

	// Backlinks depend on other files, so refetch when the tree changes
	// (create/rename/delete/save) as well as when switching notes.
	$effect(() => {
		const current = $activePath;
		$tree;
		if (!current) {
			links = [];
			return;
		}
		loading = true;
		let cancelled = false;
		fetch(`/api/backlinks?note=${encodeURIComponent(current)}`)
			.then((res) => (res.ok ? res.json() : []))
			.then((data: Backlink[]) => {
				if (!cancelled) links = Array.isArray(data) ? data : [];
			})
			.catch(() => {
				if (!cancelled) links = [];
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	function nameOf(path: string): string {
		return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
	}
</script>

<section aria-label="Backlinks">
	<header>
		<span class="material-symbols-outlined">link</span>
		<span class="title">Backlinks</span>
		{#if !loading}<span class="count">{links.length}</span>{/if}
	</header>
	{#if $activePath && !loading && links.length > 0}
		<ul>
			{#each links as l (l.path)}
				<li>
					<button onclick={() => onSelect(l.path)} title={l.path}>
						<span class="name">{nameOf(l.path)}</span>
						{#if l.excerpt}<span class="excerpt">{l.excerpt}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if $activePath && !loading}
		<p class="empty">No notes link here yet.</p>
	{/if}
</section>

<style>
	section {
		border-top: 1px solid var(--border-default);
		padding: 0.5rem var(--gutter);
		max-height: 32vh;
		overflow-y: auto;
		flex-shrink: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--on-surface-variant);
		margin-bottom: 0.25rem;
	}
	header .material-symbols-outlined {
		font-size: 16px;
	}
	.title {
		font-size: var(--font-ui-small);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		flex: 1;
	}
	.count {
		font-size: var(--font-ui-small);
		color: var(--outline);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		width: 100%;
		background: none;
		border: none;
		border-radius: var(--radius);
		padding: 0.3rem 0.4rem;
		color: var(--on-surface);
		cursor: pointer;
		text-align: left;
	}
	button:hover {
		background: var(--surface-container-low);
	}
	.name {
		font-size: var(--font-ui-medium);
		color: var(--primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.excerpt {
		font-size: var(--font-ui-small);
		color: var(--outline);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.empty {
		font-size: var(--font-ui-small);
		color: var(--outline);
		margin: 0.25rem 0;
	}
</style>
