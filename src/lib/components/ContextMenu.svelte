<script lang="ts">
	export interface ContextMenuItem {
		label: string;
		danger?: boolean;
		action: () => void;
	}

	interface Props {
		x: number;
		y: number;
		items: ContextMenuItem[];
		onClose: () => void;
	}
	let { x, y, items, onClose }: Props = $props();

	let menuEl = $state<HTMLDivElement>();
	let left = $state(0);
	let top = $state(0);

	$effect(() => {
		if (!menuEl) return;
		const rect = menuEl.getBoundingClientRect();
		left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
		top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
	});

	$effect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (menuEl && !menuEl.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey);
		window.addEventListener('blur', onClose);
		window.addEventListener('resize', onClose);
		window.addEventListener('scroll', onClose, true);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('blur', onClose);
			window.removeEventListener('resize', onClose);
			window.removeEventListener('scroll', onClose, true);
		};
	});
</script>

<div class="ctx-menu" role="menu" style="left: {left}px; top: {top}px" bind:this={menuEl}>
	{#each items as item (item.label)}
		<button
			class="ctx-item"
			class:danger={item.danger}
			role="menuitem"
			onclick={() => {
				item.action();
				onClose();
			}}
		>
			{item.label}
		</button>
	{/each}
</div>

<style>
	.ctx-menu {
		position: fixed;
		z-index: 1000;
		min-width: 160px;
		background: #1c1e26;
		border: 1px solid #2a2d38;
		border-radius: 8px;
		padding: 0.25rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
	}
	.ctx-item {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: #c9cbd6;
		padding: 0.4rem 0.6rem;
		border-radius: 5px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.ctx-item:hover {
		background: #2e313d;
	}
	.ctx-item.danger {
		color: #ff6b6b;
	}
	.ctx-item.danger:hover {
		background: #3a2226;
	}
</style>
