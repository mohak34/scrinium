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
		gap: 2px;
		height: 34px;
		padding: 0 0.5rem;
		border-bottom: 1px solid #24262f;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: thin;
		flex-shrink: 0;
		background: #14151a;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		height: 26px;
		padding: 0 0.5rem;
		border: none;
		border-radius: 6px 6px 0 0;
		background: transparent;
		color: #8a8d99;
		font-size: 0.78rem;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
		max-width: 220px;
	}
	.tab:hover {
		background: #1d1f27;
		color: #c9cbd6;
	}
	.tab.active {
		background: #1d1f27;
		color: #e6e6e6;
		box-shadow: inset 0 2px 0 #4f7cff;
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
		border-radius: 4px;
		background: none;
		font-size: 0.85rem;
		line-height: 1;
		color: #6b6e7a;
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
	}
	.tab-close:hover {
		background: #2e313d;
		color: #ff6b6b;
	}
</style>