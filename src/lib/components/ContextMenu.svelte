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
		// Leaves the menu open, for an action that shows new items in it.
		keepOpen?: boolean;
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
		// Opens upward with its bottom edge at `y`, for controls at the
		// bottom of the screen.
		above?: boolean;
	}
	let { x, y, width, items, onClose, anchor, above = false }: Props = $props();

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
		top = Math.max(8, Math.min(above ? y - rect.height : y, window.innerHeight - rect.height - 8));
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
		// A long menu scrolls itself; scrolling anything else moves the page
		// under it. Not `scroll`: a pick that keeps the menu open can redraw
		// the page, which restores scroll positions.
		const onWheel = (e: WheelEvent) => {
			if (!menuEl?.contains(e.target as Node)) onClose();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('blur', onClose);
		window.addEventListener('resize', onClose);
		window.addEventListener('wheel', onWheel, { capture: true, passive: true });
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('blur', onClose);
			window.removeEventListener('resize', onClose);
			window.removeEventListener('wheel', onWheel, true);
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
				if (!item.keepOpen) onClose();
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
		min-width: 180px;
		max-width: min(360px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		padding: 5px;
		display: flex;
		flex-direction: column;
		background: var(--menu);
		color: var(--text);
		border-radius: var(--r-xl);
		box-shadow: var(--menu-shadow);
	}
	.ctx-item {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-shrink: 0;
		width: 100%;
		height: 32px;
		padding: 0 10px;
		text-align: left;
		background: none;
		border: none;
		border-radius: 7px;
		color: var(--text);
		font: var(--t-meta) var(--font-ui);
		cursor: pointer;
		user-select: none;
	}
	.ctx-item:hover,
	.ctx-item:focus-visible,
	.ctx-item.current {
		outline: none;
		background: var(--press);
	}
	.ctx-item .material-symbols-outlined {
		font-size: 17px;
		color: var(--text-3);
	}
	.ctx-item.danger,
	.ctx-item.danger .material-symbols-outlined {
		color: var(--red);
	}
	.ctx-item.danger:hover,
	.ctx-item.danger:focus-visible {
		background: color-mix(in srgb, var(--red) 14%, transparent);
	}
	.ctx-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ctx-sep {
		height: 1px;
		margin: 5px 6px;
		flex-shrink: 0;
		background: var(--line);
	}
</style>
