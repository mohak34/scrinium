<script lang="ts">
	import { saveStatus, pinnedPaths, togglePin, deletePath } from '$lib/stores/vault';
	import { renameRequest } from '$lib/stores/actions';
	import ContextMenu from './ContextMenu.svelte';

	interface Props {
		path: string | null;
	}
	let { path }: Props = $props();

	const statusLabel: Record<string, string> = {
		idle: '',
		saving: 'Saving…',
		saved: 'Saved',
		error: 'Failed to save'
	};

	const segments = $derived(path ? path.split('/') : []);
	const pinned = $derived(!!path && $pinnedPaths.includes(path));

	let menu = $state<{ x: number; y: number } | null>(null);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	function copyPath(p: string) {
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1500);
		navigator.clipboard?.writeText(p).catch(() => {});
	}

	const menuItems = $derived.by(() => {
		const p = path;
		if (!p) return [];
		return [
			{ label: 'Rename', action: () => renameRequest.set({ path: p }) },
			{ label: 'Copy path', action: () => copyPath(p) },
			{ label: 'Move to trash', danger: true, action: () => void deletePath(p) }
		];
	});
</script>

<div class="topbar">
	<nav class="crumbs" aria-label="Breadcrumb">
		{#each segments as seg, i}
			<span class="crumb" class:last={i === segments.length - 1}>
				{#if i > 0}
					<span class="material-symbols-outlined crumb-sep">chevron_right</span>
				{/if}
				<span class="crumb-name">{seg.replace(/\.md$/, '')}</span>
			</span>
		{:else}
			<span class="crumb muted">No note open</span>
		{/each}
	</nav>
	<div class="actions">
		<span class="status" class:error={$saveStatus === 'error'}>{statusLabel[$saveStatus]}</span>
		<button
			class="top-icon"
			class:active={pinned}
			disabled={!path}
			title={pinned ? 'Unpin' : 'Pin'}
			onclick={() => path && togglePin(path)}
		>
			<span class="material-symbols-outlined">push_pin</span>
		</button>
		<button
			class="top-icon"
			class:active={copied}
			disabled={!path}
			title={copied ? 'Copied' : 'Copy path'}
			onclick={() => path && copyPath(path)}
		>
			<span class="material-symbols-outlined">{copied ? 'check' : 'share'}</span>
		</button>
		<button
			class="top-icon"
			disabled={!path}
			title="Note actions"
			onclick={(e) => path && (menu = { x: e.clientX, y: e.clientY })}
		>
			<span class="material-symbols-outlined">more_vert</span>
		</button>
	</div>
</div>

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = null)} />
{/if}

<style>
	.topbar {
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--stack-gap);
		padding: 0 var(--gutter);
		border-bottom: 1px solid var(--border-default);
		flex-shrink: 0;
		background: var(--background);
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		overflow: hidden;
		min-width: 0;
	}
	.crumb {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		white-space: nowrap;
	}
	.crumb.last {
		color: var(--on-surface);
	}
	.crumb.muted {
		color: var(--outline);
	}
	.crumb-sep {
		font-size: 14px;
		opacity: 0.5;
		color: var(--on-surface-variant);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		color: var(--on-surface-variant);
	}
	.top-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		padding: 4px;
		border: none;
		background: none;
		color: var(--on-surface-variant);
		border-radius: var(--radius);
		cursor: pointer;
		font-family: var(--font-ui);
		line-height: 1;
	}
	.top-icon:hover:not(:disabled) {
		color: var(--on-surface);
		background: var(--surface-container-low);
	}
	.top-icon:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.top-icon.active {
		color: var(--primary);
	}
	.status {
		font-size: var(--font-ui-micro);
		color: var(--outline);
	}
	.status.error {
		color: var(--error);
	}
</style>