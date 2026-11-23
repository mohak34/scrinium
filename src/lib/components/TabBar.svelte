<script lang="ts">
	import { openTabs, closeTab } from '$lib/stores/vault';

	// Open-note tabs. Note actions live in NoteBar below; this strip only
	// switches, closes and starts notes.
	interface Props {
		activePath: string | null;
		onActivate: (path: string) => void;
		sidebarCollapsed: boolean;
		onToggleSidebar: () => void;
		onNewNote: () => void;
	}
	let { activePath, onActivate, sidebarCollapsed, onToggleSidebar, onNewNote }: Props = $props();

	const tabName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
</script>

<div class="strip">
	{#if sidebarCollapsed}
		<button
			type="button"
			class="ib side"
			title="Expand sidebar (Ctrl+/)"
			onclick={onToggleSidebar}
		>
			<span class="material-symbols-outlined">left_panel_open</span>
		</button>
	{/if}
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
			<span class="material-symbols-outlined doc">description</span>
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
	<button
		type="button"
		class="ib add"
		title="New note"
		onclick={onNewNote}
	>
		<span class="material-symbols-outlined">add</span>
	</button>
</div>

<style>
	.strip {
		height: 48px;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		flex-shrink: 0;
	}
	.tab {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 120px;
		max-width: 220px;
		height: 34px;
		margin-bottom: 3px;
		padding: 0 6px 0 12px;
		border-radius: 10px;
		color: var(--text-2);
		font: 500 var(--t-meta) var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
		flex-shrink: 0;
	}
	.tab:hover {
		background: var(--hover);
		color: var(--text);
	}
	/* The active tab is a notch of the pane below: same fill, joined to it by
	   two inverted corners. */
	.tab.active {
		height: 41px;
		margin: 0 10px;
		background: var(--bg);
		color: var(--text);
		border-radius: 10px 10px 0 0;
		box-shadow: inset 1px 1px 0 var(--rim), inset -1px 0 0 var(--rim);
	}
	.tab.active::before,
	.tab.active::after {
		content: '';
		position: absolute;
		bottom: 0;
		width: 10px;
		height: 10px;
		background: radial-gradient(circle at var(--cx) 0, transparent 9.5px, var(--bg) 10px);
	}
	.tab.active::before {
		left: -10px;
		--cx: 0;
	}
	.tab.active::after {
		right: -10px;
		--cx: 10px;
	}
	/* Flush with the pane's square corner, so no left joint. */
	.tab.active:first-child {
		margin-left: 0;
	}
	.tab.active:first-child::before {
		display: none;
	}
	.doc {
		font-size: 16px;
		color: var(--text-3);
	}
	.tab.active .doc {
		color: var(--accent);
	}
	.tab-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		border-radius: 5px;
		background: none;
		color: var(--text-3);
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
		visibility: hidden;
	}
	.tab-close .material-symbols-outlined {
		font-size: 15px;
	}
	.tab:hover .tab-close,
	.tab.active .tab-close {
		visibility: visible;
	}
	.tab-close:hover {
		background: var(--press);
		color: var(--text);
	}
	.ib {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		margin-bottom: 5px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text-3);
		cursor: pointer;
		flex-shrink: 0;
	}
	.ib:hover {
		background: var(--hover);
		color: var(--text);
	}
	.ib.side {
		margin-right: 4px;
	}
</style>
