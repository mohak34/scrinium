<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	const tabs = [
		{ href: '/tasks', label: 'Agenda' },
		{ href: '/tasks/kanban', label: 'Kanban' }
	];

	function isActive(href: string): boolean {
		const cur = page.url.pathname;
		if (href === '/tasks') return cur === '/tasks';
		return cur.startsWith(href);
	}
</script>

<div class="page">
	<header class="topbar">
		<div class="left">
			<button class="icon-btn" onclick={() => goto('/')} title="Back to vault (Esc)">
				<span class="material-symbols-outlined">arrow_back</span>
			</button>
			<span class="title">Tasks</span>
			<nav class="tabs" aria-label="Tasks views">
				{#each tabs as t (t.href)}
					<button
						class="tab"
						class:on={isActive(t.href)}
						onclick={() => goto(t.href)}
						aria-current={isActive(t.href) ? 'page' : undefined}
					>
						{t.label}
					</button>
				{/each}
			</nav>
		</div>
	</header>

	<div class="scroll">
		<slot />
	</div>
</div>

<style>
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--background);
		color: var(--on-surface);
		font-family: var(--font-ui);
	}
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
	.left {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.title {
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		font-weight: var(--font-editor-title-weight);
		letter-spacing: var(--font-editor-title-tracking);
		color: var(--on-surface);
	}
	.tabs {
		display: flex;
		gap: 2px;
		margin-left: 8px;
	}
	.tab {
		height: 28px;
		padding: 0 10px;
		background: none;
		border: none;
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
	}
	.tab:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.tab.on {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface-variant);
		cursor: pointer;
		padding: 0;
	}
	.icon-btn:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
</style>
