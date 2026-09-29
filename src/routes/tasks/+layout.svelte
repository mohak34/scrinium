<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import WorkspaceSwitcher from '$lib/components/WorkspaceSwitcher.svelte';
	import TaskDrawer from '$lib/components/TaskDrawer.svelte';

	let { children } = $props();

	const tabs = [
		{ href: '/tasks', label: 'Tasks' },
		{ href: '/tasks/kanban', label: 'Board' },
		{ href: '/tasks/calendar', label: 'Calendar' }
	];

	function isActive(href: string): boolean {
		const cur = page.url.pathname;
		if (href === '/tasks') return cur === '/tasks';
		return cur.startsWith(href);
	}

	const current = $derived(page.url.pathname.startsWith('/tasks/kanban') ? 'kanban' : 'tasks');
</script>

<div class="page">
	<header class="topbar">
		<div class="left">
			<button class="icon-btn" onclick={() => goto('/')} title="Back to vault (Esc)">
				<span class="material-symbols-outlined">arrow_back</span>
			</button>
			<WorkspaceSwitcher current={current} label="Tasks" />
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
		{@render children()}
	</div>
	<TaskDrawer />
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
	.tabs {
		display: flex;
		gap: 16px;
		margin-left: 12px;
		align-self: stretch;
	}
	.tab {
		height: 100%;
		padding: 2px 2px 0;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
	}
	.tab:hover {
		color: var(--on-surface);
	}
	.tab.on {
		color: var(--on-surface);
		border-bottom-color: var(--primary);
		font-weight: 600;
	}
	.tab:focus-visible,
	.icon-btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
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
	@media (max-width: 540px) {
		.topbar { padding: 0 12px; }
		.left { gap: 8px; }
		.tabs { gap: 12px; margin-left: 2px; }
	}
</style>
