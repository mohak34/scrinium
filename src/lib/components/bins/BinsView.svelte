<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { binView, type BinTab } from '$lib/stores/bins';
	import { archiveEntries, trashEntries, loadArchive, loadTrash } from '$lib/stores/vault';
	import ArchiveTab from './ArchiveTab.svelte';
	import TrashTab from './TrashTab.svelte';
	import ReviewTab from './ReviewTab.svelte';
	import UnusedTab from './UnusedTab.svelte';

	// Full-page Archive / Trash / Review / Unused files view, mounted in the root layout so
	// Notes, Tasks and Board all open the same thing. Each tab is a list on
	// the left and a read-only preview on the right.
	const TABS: { key: BinTab; title: string; icon: string }[] = [
		{ key: 'archive', title: 'Archive', icon: 'inventory_2' },
		{ key: 'trash', title: 'Trash', icon: 'delete' },
		{ key: 'review', title: 'Review', icon: 'manage_search' },
		{ key: 'unused', title: 'Unused files', icon: 'hide_image' }
	];

	let root = $state<HTMLDivElement>();
	const isOpen = $derived($binView !== null);
	const close = () => binView.set(null);

	// A note came back and opened in a tab: show it on the notes page.
	async function opened() {
		close();
		if (page.url.pathname !== '/') await goto('/');
	}

	$effect(() => {
		if (!isOpen) return;
		void loadArchive();
		void loadTrash();
		const prev = document.activeElement as HTMLElement | null;
		void tick().then(() => root?.focus());

		// Modal like the settings dialog: app shortcuts never fire underneath.
		const onKey = (e: KeyboardEvent) => {
			e.stopPropagation();
			if (e.key === 'Escape') {
				e.preventDefault();
				close();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			prev?.focus?.();
		};
	});

	const count = (key: BinTab) =>
		key === 'archive' ? $archiveEntries.length : key === 'trash' ? $trashEntries.length : 0;
</script>

{#if $binView}
	<div class="bins" role="dialog" aria-modal="true" aria-label="Archive and trash" tabindex="-1" bind:this={root}>
		<header>
			<nav>
				{#each TABS as t (t.key)}
					<button class="tab" class:on={t.key === $binView.tab} onclick={() => binView.set({ tab: t.key })}>
						<span class="material-symbols-outlined" class:fill={t.key === $binView.tab}>{t.icon}</span>
						{t.title}
						{#if count(t.key)}<span class="c">{count(t.key)}</span>{/if}
					</button>
				{/each}
			</nav>
			<span class="kbd">Esc</span>
			<button class="ib" title="Close" onclick={close}>
				<span class="material-symbols-outlined">close</span>
			</button>
		</header>
		{#if $binView.tab === 'archive'}
			<ArchiveTab focus={$binView.focus} onOpened={opened} />
		{:else if $binView.tab === 'trash'}
			<TrashTab onOpened={opened} />
		{:else if $binView.tab === 'review'}
			<ReviewTab onOpened={opened} />
		{:else}
			<UnusedTab />
		{/if}
	</div>
{/if}

<style>
	.bins {
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
		padding: 0 12px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}
	nav {
		flex: 1;
		display: flex;
		gap: 2px;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		cursor: pointer;
	}
	.tab .material-symbols-outlined {
		font-size: 18px;
		color: var(--text-3);
	}
	.tab:hover {
		background: var(--hover);
		color: var(--text);
	}
	.tab.on {
		background: var(--accent-dim);
		color: var(--text);
	}
	.tab.on .material-symbols-outlined {
		color: var(--accent);
	}
	.c {
		color: var(--text-3);
		font: 11px var(--font-mono);
	}
	.kbd {
		color: var(--text-4);
		font: 11px var(--font-mono);
	}

	/* Shared by the tabs: list pane, rows, preview pane, buttons. */
	.bins :global(.ib) {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
		flex-shrink: 0;
	}
	.bins :global(.ib:hover:not(:disabled)) {
		background: var(--press);
		color: var(--text);
	}
	.bins :global(.ib.del:hover:not(:disabled)) {
		color: var(--red);
	}
	.bins :global(.panes) {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.bins :global(.list) {
		width: 420px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--line);
		background: var(--panel);
	}
	.bins :global(.tools) {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px;
	}
	.bins :global(.filter) {
		flex: 1;
		min-width: 0;
		height: 30px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		color: var(--text-3);
	}
	.bins :global(.filter:focus-within) {
		border-color: var(--line-3);
	}
	.bins :global(.filter input) {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: none;
		color: var(--text);
		font: var(--fs-sm) var(--font-ui);
	}
	.bins :global(.filter .material-symbols-outlined) {
		font-size: 17px;
	}
	.bins :global(.rows) {
		flex: 1;
		overflow-y: auto;
		padding: 0 8px 16px;
	}
	.bins :global(.gh) {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 14px 8px 6px;
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text-2);
	}
	.bins :global(.gh .n) {
		color: var(--text-4);
		font: 11px var(--font-mono);
	}
	.bins :global(.row) {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 4px 8px;
		border-radius: var(--r);
		cursor: pointer;
	}
	.bins :global(.row:hover) {
		background: var(--hover);
	}
	.bins :global(.row.on) {
		background: var(--accent-dim);
	}
	.bins :global(.row .kind) {
		font-size: 18px;
		color: var(--text-3);
	}
	.bins :global(.row .txt) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bins :global(.row .nm),
	.bins :global(.row .dir) {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bins :global(.row .nm) {
		font-size: var(--fs);
		color: var(--text);
	}
	.bins :global(.row .dir) {
		font-size: var(--fs-xs);
		color: var(--text-3);
	}
	.bins :global(.row .tm) {
		color: var(--text-3);
		font: 11px var(--font-mono);
		white-space: nowrap;
	}
	.bins :global(.row .acts) {
		display: none;
		gap: 2px;
	}
	.bins :global(.row:hover .acts),
	.bins :global(.row:focus-within .acts) {
		display: flex;
	}
	.bins :global(.row:hover .tm),
	.bins :global(.row:focus-within .tm) {
		display: none;
	}
	.bins :global(.empty) {
		padding: 28px 8px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.bins :global(.view) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bins :global(.vhead) {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		padding: 10px 32px;
		border-bottom: 1px solid var(--line);
	}
	.bins :global(.vhead .txt) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bins :global(.vhead h2) {
		margin: 0;
		font: 600 var(--fs-lg) var(--font-ui);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bins :global(.vhead .meta) {
		font-size: var(--fs-sm);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bins :global(.vbody) {
		flex: 1;
		overflow-y: auto;
		padding: 8px 32px;
	}
	.bins :global(.inside) {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 12px 0 4px;
	}
	.bins :global(.chip) {
		height: 26px;
		padding: 0 10px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs-sm) var(--font-ui);
		cursor: pointer;
	}
	.bins :global(.chip:hover) {
		color: var(--text);
		border-color: var(--line-3);
	}
	.bins :global(.chip.on) {
		color: var(--text);
		border-color: var(--accent);
	}
	.bins :global(.btn) {
		height: 28px;
		padding: 0 11px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: var(--raise);
		color: var(--text);
		font: var(--fs-sm) var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
	}
	.bins :global(.btn .material-symbols-outlined) {
		font-size: 16px;
	}
	.bins :global(.btn:hover:not(:disabled)) {
		background: var(--hover);
		border-color: var(--line-3);
	}
	.bins :global(.btn:disabled) {
		opacity: 0.5;
		cursor: default;
	}
	.bins :global(.btn.primary) {
		background: var(--accent-fill);
		border-color: var(--accent-fill);
		color: var(--on-accent);
	}
	.bins :global(.btn.primary:hover:not(:disabled)) {
		background: var(--accent-fill-hi);
		border-color: var(--accent-fill-hi);
	}
	.bins :global(.btn.danger) {
		color: var(--red);
	}
	.bins :global(.btn.danger:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--red) 12%, transparent);
		border-color: color-mix(in srgb, var(--red) 35%, transparent);
	}
</style>
