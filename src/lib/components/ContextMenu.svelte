<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		createMenuController,
		Menu,
		MenuContent,
		MenuItem,
		MenuItemIcon,
		MenuSeparator
	} from '@ui-sdk/svelte/menu';

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
		// The control that opened the menu, so pressing it again closes the
		// menu instead of reopening it.
		anchor?: HTMLElement;
	}
	let { x, y, width, items, onClose, anchor }: Props = $props();

	// ui-sdk's menu owns focus, arrows, typeahead and dismissal; this
	// component only opens it at a point and keeps the app's item shape.
	const menu = createMenuController();

	onMount(() => {
		void menu.open({ anchor: { x, y } }).then((r) => {
			if (r.reason !== 'unmount') onClose();
		});
		void tick().then(() =>
			document.querySelector<HTMLElement>('.ctx-menu [data-current]')?.focus({ preventScroll: true })
		);
		// The anchor's own click would reopen the menu right after it closes.
		const swallow = (e: PointerEvent) => {
			if (!anchor?.contains(e.target as Node)) return;
			anchor.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
		};
		const close = () => menu.close();
		window.addEventListener('pointerdown', swallow, true);
		window.addEventListener('resize', close);
		window.addEventListener('blur', close);
		return () => {
			window.removeEventListener('pointerdown', swallow, true);
			window.removeEventListener('resize', close);
			window.removeEventListener('blur', close);
		};
	});
</script>

<Menu controller={menu}>
	<MenuContent
		class="ctx-menu"
		side="bottom"
		align="start"
		sideOffset={0}
		collisionPadding={8}
		style={width ? `width: ${width}px` : undefined}
		onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
	>
		{#each items as item, i (i)}
			{#if item.divider}<MenuSeparator class="ctx-sep" />{/if}
			<MenuItem
				class="ctx-item {item.danger ? 'danger' : ''}"
				value={String(i)}
				data-current={item.current || undefined}
				onSelect={() => item.action()}
			>
				{#if item.icon}
					<MenuItemIcon>
						<span class="material-symbols-outlined" class:fill={item.color} style:color={item.color}>{item.icon}</span>
					</MenuItemIcon>
				{/if}
				<span class="ctx-label">{item.label}</span>
			</MenuItem>
		{/each}
	</MenuContent>
</Menu>

<style>
	:global(.ctx-menu) {
		z-index: 1000;
		min-width: 180px;
		max-width: min(360px, calc(100vw - 16px));
		max-height: min(var(--available-height, 100vh), calc(100vh - 16px));
		overflow-y: auto;
		margin: 0;
		padding: 5px;
		display: flex;
		flex-direction: column;
		background: var(--menu);
		color: var(--text);
		border: none;
		border-radius: var(--r-xl);
		box-shadow: var(--menu-shadow);
		outline: none;
	}
	:global(.ctx-menu .ctx-item) {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 32px;
		padding: 0 10px;
		border-radius: 7px;
		color: var(--text);
		font: var(--t-meta) var(--font-ui);
		cursor: pointer;
		outline: none;
		user-select: none;
	}
	:global(.ctx-menu .ctx-item[data-highlighted]),
	:global(.ctx-menu .ctx-item[data-current]) {
		background: var(--press);
	}
	:global(.ctx-menu .ctx-item .material-symbols-outlined) {
		font-size: 17px;
		color: var(--text-3);
	}
	:global(.ctx-menu .ctx-item.danger),
	:global(.ctx-menu .ctx-item.danger .material-symbols-outlined) {
		color: var(--red);
	}
	:global(.ctx-menu .ctx-item.danger[data-highlighted]) {
		background: color-mix(in srgb, var(--red) 14%, transparent);
	}
	:global(.ctx-menu .ctx-label) {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.ctx-menu .ctx-sep) {
		height: 1px;
		margin: 5px 6px;
		background: var(--line);
		flex-shrink: 0;
	}
</style>
