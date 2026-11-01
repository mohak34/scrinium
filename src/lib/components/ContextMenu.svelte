<script lang="ts">
	export interface ContextMenuItem {
		label: string;
		danger?: boolean;
		// A Material Symbols name drawn before the label; a `color` fills it.
		icon?: string;
		color?: string;
		// Draws a line above the item, starting a new group.
		divider?: boolean;
		// Marks the option that is in use, for menus that pick one.
		current?: boolean;
		action: () => void;
	}

	interface Props {
		x: number;
		y: number;
		// Matches the menu to the control it drops from.
		width?: number;
		items: ContextMenuItem[];
		onClose: () => void;
		// The control that opened the menu: pressing it again toggles the
		// menu shut instead of closing and reopening it.
		anchor?: HTMLElement;
	}
	let { x, y, width, items, onClose, anchor }: Props = $props();

	let menuEl = $state<HTMLDivElement>();
	let left = $state(0);
	let top = $state(0);

	// Keyboard: focus lands on the current item (or the first), arrows,
	// Home and End move between items, Enter picks.
	$effect(() => {
		const start = menuEl?.querySelector<HTMLElement>('.ctx-item.current') ?? menuEl?.querySelector<HTMLElement>('.ctx-item');
		start?.focus({ preventScroll: true });
		start?.scrollIntoView({ block: 'nearest' });
	});
	function moveFocus(e: KeyboardEvent): boolean {
		const list = [...(menuEl?.querySelectorAll<HTMLElement>('.ctx-item') ?? [])];
		const at = list.indexOf(document.activeElement as HTMLElement);
		const next =
			e.key === 'ArrowDown' ? (at + 1) % list.length
			: e.key === 'ArrowUp' ? (at - 1 + list.length) % list.length
			: e.key === 'Home' ? 0
			: e.key === 'End' ? list.length - 1
			: -1;
		if (next < 0) return false;
		list[next]?.focus();
		return true;
	}

	$effect(() => {
		if (!menuEl) return;
		const rect = menuEl.getBoundingClientRect();
		left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
		top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
	});

	$effect(() => {
		const onPointerDown = (e: PointerEvent) => {
			const t = e.target as Node;
			if (menuEl?.contains(t)) return;
			if (anchor?.contains(t)) {
				// The anchor's own click would reopen the menu right after.
				e.preventDefault();
				anchor.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
			}
			onClose();
		};
		// Captured and claimed, so the keys the menu uses reach nothing
		// under it (the task drawer, a dialog's shortcuts).
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
			else if (!moveFocus(e)) return;
			e.preventDefault();
			e.stopPropagation();
		};
		// A long menu scrolls itself; any other scroll moves the page under it.
		const onScroll = (e: Event) => {
			if (!menuEl?.contains(e.target as Node)) onClose();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('blur', onClose);
		window.addEventListener('resize', onClose);
		window.addEventListener('scroll', onScroll, true);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('blur', onClose);
			window.removeEventListener('resize', onClose);
			window.removeEventListener('scroll', onScroll, true);
		};
	});
</script>

<div class="ctx-menu" role="menu" style="left: {left}px; top: {top}px" style:width={width ? `${width}px` : undefined} bind:this={menuEl}>
	{#each items as item, i (i)}
		{#if item.divider}<div class="ctx-sep" role="separator"></div>{/if}
		<button
			class="ctx-item"
			class:danger={item.danger}
			class:current={item.current}
			role="menuitem"
			aria-current={item.current || undefined}
			onclick={() => {
				item.action();
				onClose();
			}}
		>
			{#if item.icon}
				<span class="material-symbols-outlined" class:fill={item.color} style:color={item.color}>{item.icon}</span>
			{/if}
			<span class="ctx-label">{item.label}</span>
		</button>
	{/each}
</div>

<style>
	.ctx-menu {
		position: fixed;
		z-index: 1000;
		min-width: 160px;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		padding: 4px;
		box-shadow: var(--shadow-pop);
		display: flex;
		flex-direction: column;
		max-width: min(360px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow-y: auto;
	}
	.ctx-item {
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
	.ctx-item:focus-visible {
		outline: none;
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.ctx-item:hover {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.ctx-item:hover .material-symbols-outlined:not(.fill) {
		color: var(--on-surface);
	}
	.ctx-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ctx-sep {
		height: 1px;
		background: var(--line);
		margin: 4px 6px;
	}
	.ctx-item .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.ctx-item.current {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.ctx-item.danger,
	.ctx-item.danger .material-symbols-outlined {
		color: var(--error);
	}
	.ctx-item.danger:hover {
		background: var(--error-container);
	}
</style>
