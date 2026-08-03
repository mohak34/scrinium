<script lang="ts">
	import { openTabs, closeTab } from '$lib/stores/vault';

	interface Props {
		activePath: string | null;
		onActivate: (path: string) => void;
	}
	let { activePath, onActivate }: Props = $props();

	const tabName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
</script>

<div class="tabbar">
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
				×
			</button>
		</div>
	{/each}
</div>

<style>
	.tabbar {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		height: 40px;
		padding: 0 var(--gutter);
		border-bottom: 1px solid var(--border-default);
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: thin;
		flex-shrink: 0;
		flex-wrap: nowrap;
		background: var(--surface);
	}
	.tab {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		height: 28px;
		padding: 0 var(--panel-padding);
		border: none;
		border-radius: var(--radius);
		background: transparent;
		color: var(--on-surface-variant);
		font-size: var(--font-ui-small);
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
		max-width: 220px;
	}
	.tab:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.tab.active {
		background: var(--surface-container-high);
		color: var(--on-surface);
		box-shadow: inset 0 2px 0 var(--primary);
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
		font-size: 0.85rem;
		line-height: 1;
		color: var(--outline);
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
	}
	.tab-close:hover {
		background: var(--surface-container-high);
		color: var(--error);
	}
</style>