<script lang="ts">
	import { goto } from '$app/navigation';
	import { pinnedPaths, togglePin, deletePath, downloadNote, flushSave } from '$lib/stores/vault';
	import { renameRequest } from '$lib/stores/actions';
	import ContextMenu from './ContextMenu.svelte';
	import ShareModal from './ShareModal.svelte';

	// The bar under the tabs: where the open note lives, and what you can do
	// with it. The right-panel toggle sits at the far end, over the panel.
	interface Props {
		path: string;
		rightOpen: boolean;
		onTogglePreview: () => void;
		onToggleRight: () => void;
	}
	let { path, rightOpen, onTogglePreview, onToggleRight }: Props = $props();

	let menu = $state<{ x: number; y: number } | null>(null);
	let shareOpen = $state(false);

	const segments = $derived(path.replace(/\.md$/, '').split('/'));
	const pinned = $derived($pinnedPaths.includes(path));

	const menuItems = $derived([
		{ label: pinned ? 'Unpin' : 'Pin to sidebar', action: () => togglePin(path) },
		{ label: 'Rename', action: () => renameRequest.set({ path }) },
		{ label: 'Copy path', action: () => void navigator.clipboard?.writeText(path).catch(() => {}) },
		{ label: 'Download .md', action: () => void downloadNote(path).catch(() => {}) },
		{ label: 'Move to trash', danger: true, action: () => void deletePath(path) }
	]);

	async function printNote() {
		// The print page reads the server copy; skip it while a save fails.
		if (!(await flushSave())) return;
		goto(`/print?note=${encodeURIComponent(path)}`);
	}
</script>

<div class="bar">
	<nav class="crumbs" aria-label="Note location">
		{#each segments as seg, i (i)}
			{#if i > 0}<span class="material-symbols-outlined sep">chevron_right</span>{/if}
			<span class:here={i === segments.length - 1}>{seg}</span>
		{/each}
		{#if pinned}<span class="material-symbols-outlined pin fill" title="Pinned">keep</span>{/if}
	</nav>
	<button class="btn" title="Preview (Esc)" onclick={onTogglePreview}>
		<span class="material-symbols-outlined">visibility</span>
	</button>
	<button class="btn" title="Print / PDF" onclick={() => void printNote()}>
		<span class="material-symbols-outlined">picture_as_pdf</span>
	</button>
	<button
		class="btn"
		title="More"
		onclick={(e) => {
			const r = e.currentTarget.getBoundingClientRect();
			menu = { x: r.left, y: r.bottom + 4 };
		}}
	>
		<span class="material-symbols-outlined">more_horiz</span>
	</button>
	<span class="vsep"></span>
	<button class="btn line" onclick={() => (shareOpen = true)}>
		<span class="material-symbols-outlined">ios_share</span>Share
	</button>
	<button
		class="btn"
		title={rightOpen ? 'Hide right panel' : 'Show right panel'}
		onclick={onToggleRight}
	>
		<span class="material-symbols-outlined">{rightOpen ? 'right_panel_close' : 'right_panel_open'}</span>
	</button>
</div>

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = null)} />
{/if}

{#if shareOpen}
	<ShareModal onClose={() => (shareOpen = false)} />
{/if}

<style>
	.bar {
		height: 44px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 10px 0 20px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
		background: var(--bg);
	}
	.crumbs {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		color: var(--text-3);
		font-size: var(--fs);
		white-space: nowrap;
		overflow: hidden;
	}
	.crumbs span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sep {
		font-size: 16px;
	}
	.here {
		color: var(--text);
		font-weight: 500;
	}
	.pin {
		font-size: 15px;
		color: var(--accent);
		margin-left: 6px;
	}
	.btn {
		height: 30px;
		min-width: 30px;
		padding: 0 7px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text-2);
		font: 500 var(--fs) var(--font-ui);
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.btn.line {
		border: 1px solid var(--line-2);
		padding: 0 11px 0 9px;
		margin-right: 4px;
	}
	.vsep {
		width: 1px;
		height: 18px;
		background: var(--line-2);
		margin: 0 6px;
	}
</style>
