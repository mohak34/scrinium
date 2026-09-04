<script lang="ts">
	import { activePath } from '$lib/stores/vault';
	import { tree } from '$lib/stores/vault';

	interface Props {
		onSelect: (path: string) => void;
		onClose: () => void;
	}
	let { onSelect, onClose }: Props = $props();

	interface Backlink {
		path: string;
		excerpt: string;
	}

	let links = $state<Backlink[]>([]);
	let loading = $state(false);
	let failed = $state(false);

	// Backlinks depend on other files, so refetch when the tree changes
	// (create/rename/delete/save) as well as when switching notes.
	$effect(() => {
		const current = $activePath;
		$tree;
		if (!current) {
			links = [];
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
			.then((data: Backlink[]) => {
				if (!cancelled) links = Array.isArray(data) ? data : [];
			})
			.catch(() => {
				if (!cancelled) {
					links = [];
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

	function nameOf(path: string): string {
		return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
	}
</script>

<section aria-label="Linked mentions">
	<header>
		<span class="title">Linked mentions</span>
		<button class="close-btn" onclick={onClose} title="Close panel">
			<span class="material-symbols-outlined">close</span>
		</button>
	</header>
	{#if $activePath && !loading && links.length > 0}
		<ul>
			{#each links as l (l.path)}
				<li>
					<button onclick={() => onSelect(l.path)} title={l.path}>
						<span class="name">{nameOf(l.path)}</span>
						{#if l.excerpt}<span class="excerpt">"{l.excerpt}"</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if $activePath && !loading && failed}
		<p class="empty">Couldn't load backlinks.</p>
	{:else if $activePath && !loading}
		<p class="empty">None yet.</p>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
		padding: 1rem var(--gutter);
		overflow-y: auto;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 1rem;
	}
	.title {
		font-size: var(--font-label-caps);
		line-height: var(--font-label-caps-lh);
		font-weight: var(--font-label-caps-weight);
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--on-surface-variant);
		flex: 1;
	}
	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface-variant);
		cursor: pointer;
		line-height: 1;
		opacity: 0;
	}
	header:hover .close-btn,
	.close-btn:focus-visible {
		opacity: 1;
	}
	.close-btn:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.close-btn .material-symbols-outlined {
		font-size: 16px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	li button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
	}
	.name {
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	li button:hover .name {
		color: var(--primary);
	}
	.excerpt {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.empty {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		margin: 0;
	}
</style>
