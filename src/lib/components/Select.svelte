<script lang="ts" module>
	export type SelectOption<V extends string> = { value: V; label: string; icon?: string; color?: string };
</script>

<script lang="ts" generics="T extends string">
	import ContextMenu from './ContextMenu.svelte';

	// A themed stand-in for <select>: a button that opens the app's menu
	// under it. `grow` fills the row and makes the menu as wide as the button;
	// `boxed` draws the input border, for forms.
	interface Props {
		value: T;
		options: SelectOption<T>[];
		onchange: (value: T) => void;
		label: string;
		grow?: boolean;
		boxed?: boolean;
		disabled?: boolean;
	}
	let { value, options, onchange, label, grow = false, boxed = false, disabled = false }: Props = $props();

	let button = $state<HTMLButtonElement>();
	let at = $state<DOMRect | null>(null);
	const current = $derived(options.find((o) => o.value === value));

	function toggle() {
		at = at ? null : (button?.getBoundingClientRect() ?? null);
	}
</script>

<button
	bind:this={button}
	type="button"
	class="select"
	class:grow
	class:boxed
	class:open={at}
	aria-label={label}
	aria-haspopup="menu"
	aria-expanded={!!at}
	{disabled}
	onclick={toggle}
	onkeydown={(e) => {
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !at) {
			e.preventDefault();
			toggle();
		}
	}}
>
	{#if current?.icon}
		<span class="material-symbols-outlined ic" class:fill={current.color} style:color={current.color}>{current.icon}</span>
	{/if}
	<span class="txt">{current?.label ?? ''}</span>
	<span class="material-symbols-outlined chev">expand_more</span>
</button>
{#if at}
	<ContextMenu
		x={at.left}
		y={at.bottom + 4}
		width={grow ? at.width : undefined}
		anchor={button}
		items={options.map((o) => ({
			label: o.label,
			icon: o.icon,
			color: o.color,
			current: o.value === value,
			action: () => {
				if (o.value !== value) onchange(o.value);
			}
		}))}
		onClose={() => {
			at = null;
			// Back to the button after a pick or Esc, not when focus left for
			// something else.
			if (document.activeElement?.closest('.ctx-menu') || document.activeElement === document.body)
				button?.focus({ preventScroll: true });
		}}
	/>
{/if}

<style>
	.select {
		height: 30px;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 6px 0 8px;
		border: 1px solid transparent;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: var(--fs) var(--font-ui);
		cursor: pointer;
		text-align: left;
	}
	.select:hover:not(:disabled),
	.select.open {
		background: var(--hover);
	}
	.select:focus-visible {
		outline: none;
		border-color: var(--accent);
	}
	.select:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.boxed {
		border-color: var(--line-2);
		background: var(--bg);
	}
	.boxed:hover:not(:disabled) {
		border-color: var(--line-3);
		background: var(--bg);
	}
	.boxed.open {
		border-color: var(--accent);
		background: var(--bg);
	}
	.grow {
		flex: 1;
	}
	.txt {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ic {
		font-size: 17px;
		color: var(--text-3);
	}
	.chev {
		font-size: 18px;
		color: var(--text-3);
	}
</style>
