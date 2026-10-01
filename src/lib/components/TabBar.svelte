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
		height: 40px;
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		flex-shrink: 0;
		background: var(--panel);
	}
	.tab {
		position: relative;
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 130px;
		max-width: 220px;
		padding: 0 8px 0 14px;
		border-right: 1px solid var(--line);
		color: var(--text-3);
		font-size: var(--fs);
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
		flex-shrink: 0;
	}
	.tab:hover {
		color: var(--text-2);
	}
	.tab.active {
		color: var(--text);
		background: var(--bg);
	}
	/* Active tab merges into the page: accent rule on top, no bottom edge. */
	.tab.active::before {
		content: '';
		position: absolute;
		inset: 0 0 auto;
		height: 1.5px;
		background: var(--accent);
	}
	.tab.active::after {
		content: '';
		position: absolute;
		inset: auto 0 -1px;
		height: 1px;
		background: var(--bg);
	}
	.doc {
		font-size: 16px;
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
		border-radius: var(--r-sm);
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
		align-self: center;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		margin: 0 4px;
		border: none;
		border-radius: var(--r);
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
		margin-left: 8px;
	}
</style>
