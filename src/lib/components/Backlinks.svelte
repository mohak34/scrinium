<script lang="ts">
	import { activePath, linkUnlinkedMention } from '$lib/stores/vault';
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
</script>

<section aria-label="Linked mentions">
	<header>
		<span class="title">Linked mentions</span>
		{#if $activePath && !loading && !failed && links.length > 0}
			<span class="count">{links.length}</span>
		{/if}
		<button class="close-btn" onclick={onClose} title="Close panel">
			<span class="material-symbols-outlined">close</span>
		</button>
	</header>
	{#if $activePath && !loading && links.length > 0}
		<ul>
			{#each links as l (l.path)}
				<li>
					<button onclick={() => onSelect(l.path)} title={l.path}>
						<span class="name-row">
							<span class="material-symbols-outlined link-icon">link</span>
							<span class="name">{nameOf(l.path)}</span>
						</span>
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
	{#if $activePath && !loading && !failed && unlinked.length > 0}
		<header class="sub">
			<span class="title">Unlinked mentions</span>
		</header>
		<ul>
			{#each unlinked as u (u.path)}
				<li>
					<button onclick={() => onSelect(u.path)} title={u.path}>
						<span class="name-row">
							<span class="material-symbols-outlined link-icon">link</span>
							<span class="name">{nameOf(u.path)}</span>
						</span>
						{#if u.excerpt}<span class="excerpt">"{u.excerpt}"</span>{/if}
					</button>
					<button
						class="link-btn"
						disabled={linking === u.path}
						onclick={() => link(u.path)}
						title="Convert to [[link]]"
					>
						{linking === u.path ? 'Linking…' : 'Link'}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		flex: none;
		max-height: 45%;
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
		font-size: var(--font-ui-small);
		line-height: var(--font-ui-small-lh);
		font-weight: 600;
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--on-surface-variant);
		flex: 1;
	}
	.count {
		font-size: var(--font-ui-small);
		color: var(--on-surface);
		background: var(--surface-container-low);
		border-radius: var(--radius);
		padding: 1px 8px;
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
	}
	.close-btn:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.close-btn .material-symbols-outlined {
		font-size: 16px;
	}
	header.sub {
		margin-top: 1.5rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	li {
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
	}
	li button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		background: none;
		border: none;
		padding: 7px 10px;
		cursor: pointer;
		text-align: left;
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
	}
	.link-icon {
		flex: none;
		font-size: 16px;
		color: var(--primary);
	}
	.name {
		font-size: var(--font-ui-small);
		font-weight: 600;
		color: var(--on-surface);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	li button:hover .name {
		color: var(--primary);
	}
	.link-btn {
		align-self: flex-start;
		margin: 2px 0 7px 10px;
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-micro);
		padding: 1px 8px;
		cursor: pointer;
		width: auto;
	}
	.link-btn:hover:not(:disabled) {
		color: var(--primary);
		border-color: var(--primary);
	}
	.link-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.excerpt {
		font-size: var(--font-ui-micro);
		color: var(--on-surface-variant);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.empty {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		margin: 0;
	}
</style>
