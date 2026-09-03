<script lang="ts">
	import { openTabs, closeTab, saveStatus, pinnedPaths, togglePin, deletePath, downloadNote } from '$lib/stores/vault';
	import { renameRequest } from '$lib/stores/actions';
	import ContextMenu from './ContextMenu.svelte';

	interface Props {
		activePath: string | null;
		onActivate: (path: string) => void;
	}
	let { activePath, onActivate }: Props = $props();

	let menu = $state<{ x: number; y: number } | null>(null);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	const tabName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
	const pinned = $derived(!!activePath && $pinnedPaths.includes(activePath));

	const statusLabel: Record<string, string> = {
		idle: '',
		saving: 'Saving…',
		saved: 'Saved',
		error: 'Failed to save'
	};

	function copyPath(p: string) {
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1500);
		navigator.clipboard?.writeText(p).catch(() => {});
	}

	const menuItems = $derived.by(() => {
		const p = activePath;
		if (!p) return [];
		return [
			{ label: 'Rename', action: () => renameRequest.set({ path: p }) },
			{ label: 'Copy path', action: () => copyPath(p) },
			{ label: 'Download .md', action: () => void downloadNote(p).catch(() => {}) },
			{ label: 'Move to trash', danger: true, action: () => void deletePath(p) }
		];
	});
</script>

<div class="strip">
	{#each $openTabs as path (path)}
		<div
			class="tab"
			class:active={activePath === path}
			title={path}
			role="button"
			tabindex="0"
			onclick={() => onActivate(path)}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onActivate(path);
				}
			}}
			onauxclick={(e) => {
				if (e.button === 1) closeTab(path);
			}}
		>
			<span class="tab-name">{tabName(path)}</span>
			<button
				type="button"
				class="tab-close"
				title="Close tab"
				onclick={(e) => {
					e.stopPropagation();
					closeTab(path);
				}}
			>
				<span class="material-symbols-outlined">close</span>
			</button>
		</div>
	{/each}

	<div class="end">
		{#if activePath}
			<span class="status" class:error={$saveStatus === 'error'} title="Save status">
				<span
					class="sdot"
					class:err={$saveStatus === 'error'}
					class:busy={$saveStatus === 'saving'}
				></span>
				{#if $saveStatus === 'error' || $saveStatus === 'saving'}{statusLabel[$saveStatus]}{/if}
			</span>
			<button
				class="ibtn"
				class:pinned
				disabled={!activePath}
				title={pinned ? 'Unpin' : 'Pin'}
				onclick={() => activePath && togglePin(activePath)}
			>
				<span class="material-symbols-outlined">push_pin</span>
			</button>
			<button
				class="ibtn"
				class:copied
				disabled={!activePath}
				title={copied ? 'Copied' : 'Copy path'}
				onclick={() => activePath && copyPath(activePath)}
			>
				<span class="material-symbols-outlined">{copied ? 'check' : 'content_copy'}</span>
			</button>
			<button
				class="ibtn"
				disabled={!activePath}
				title="Note actions"
				onclick={(e) => activePath && (menu = { x: e.clientX, y: e.clientY })}
			>
				<span class="material-symbols-outlined">more_vert</span>
			</button>
		{/if}
	</div>
</div>

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = null)} />
{/if}

<style>
	.strip {
		height: 40px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 10px;
		border-bottom: 1px solid var(--border-default);
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: thin;
		flex-shrink: 0;
		background: var(--surface);
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 8px;
		max-width: 200px;
		border-radius: var(--radius);
		color: var(--outline);
		font-size: var(--font-ui-small);
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
		flex-shrink: 0;
	}
	.tab:hover {
		background: var(--surface-container-low);
		color: var(--on-surface-variant);
	}
	.tab.active {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.tab.active .tab-name {
		font-weight: var(--font-ui-medium-weight);
	}
	.tab-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--outline);
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
		visibility: hidden;
	}
	.tab-close .material-symbols-outlined {
		font-size: 13px;
	}
	.tab:hover .tab-close,
	.tab.active .tab-close {
		visibility: visible;
	}
	.tab-close:hover {
		background: var(--surface-container-highest);
		color: var(--error);
	}
	.end {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 5px;
		color: var(--outline);
		font-size: var(--font-ui-micro);
		margin-right: 6px;
		white-space: nowrap;
	}
	.status.error {
		color: var(--error);
	}
	.sdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success);
	}
	.sdot.busy {
		background: var(--outline-variant);
	}
	.sdot.err {
		background: var(--error);
	}
	.ibtn {
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--outline);
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}
	.ibtn .material-symbols-outlined {
		font-size: 17px;
	}
	.ibtn:hover:not(:disabled) {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.ibtn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.ibtn.pinned,
	.ibtn.copied {
		color: var(--primary);
	}
</style>
