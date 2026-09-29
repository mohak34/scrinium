<script lang="ts">
	import { goto } from '$app/navigation';

	interface Props {
		current: 'notes' | 'tasks' | 'kanban';
		label: string;
	}

	let { current, label }: Props = $props();

	let open = $state(false);
	let wrapEl = $state<HTMLDivElement>();

	const options = [
		{ key: 'notes', label: 'Notes', icon: 'description', href: '/' },
		{ key: 'tasks', label: 'Tasks', icon: 'task', href: '/tasks' },
		{ key: 'kanban', label: 'Kanban', icon: 'view_kanban', href: '/tasks/kanban' }
	] as const;

	function toggle(e: MouseEvent) {
		e.stopPropagation();
		open = !open;
	}

	function go(href: string) {
		open = false;
		goto(href);
	}

	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (wrapEl && !wrapEl.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="switcher" bind:this={wrapEl}>
	<button
		class="brand-btn"
		onclick={toggle}
		aria-haspopup="menu"
		aria-expanded={open}
		title="Switch workspace"
	>
		<span class="brand">{label}</span>
		<span class="material-symbols-outlined chev" class:open>expand_more</span>
	</button>
	{#if open}
		<div class="menu" role="menu" aria-label="Switch workspace">
			{#each options as o (o.key)}
				<button
					class="item"
					class:on={current === o.key}
					role="menuitem"
					onclick={() => go(o.href)}
				>
					<span class="material-symbols-outlined item-icon">{o.icon}</span>
					<span class="item-label">{o.label}</span>
					{#if current === o.key}
						<span class="material-symbols-outlined item-check">check</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.switcher {
		position: relative;
		min-width: 0;
	}
	.brand-btn {
		display: flex;
		align-items: center;
		gap: 2px;
		background: none;
		border: none;
		border-radius: var(--radius);
		padding: 2px 4px;
		margin-left: -4px;
		cursor: pointer;
		color: var(--on-surface);
		max-width: 100%;
	}
	.brand-btn:hover {
		background: var(--surface-container-low);
	}
	.brand {
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		font-weight: var(--font-editor-title-weight);
		letter-spacing: var(--font-editor-title-tracking);
		color: var(--on-surface);
		white-space: nowrap;
	}
	.chev {
		font-size: 16px;
		color: var(--outline);
		transition: transform 0.15s ease;
	}
	.chev.open {
		transform: rotate(180deg);
	}
	.brand-btn:hover .chev {
		color: var(--on-surface);
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 1000;
		min-width: 172px;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		padding: 4px;
		box-shadow: var(--shadow-pop);
		display: flex;
		flex-direction: column;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: var(--on-surface-variant);
		padding: 6px 8px;
		border-radius: var(--radius);
		font-size: var(--font-ui-small);
		font-family: var(--font-ui);
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.item.on {
		color: var(--on-surface);
	}
	.item-icon {
		font-size: 16px;
		opacity: 0.8;
	}
	.item-label {
		flex: 1;
	}
	.item-check {
		font-size: 16px;
		color: var(--primary);
	}
</style>
