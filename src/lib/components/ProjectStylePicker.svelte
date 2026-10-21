<script lang="ts">
	import { PROJECT_COLORS, PROJECT_ICONS, colorVar, type ProjectColor, type ProjectIcon } from '$lib/projects';
	import { styleProject } from '$lib/stores/tasks';

	// The project section's icon and color, opened from its right-click menu.
	// Each pick saves at once; Esc or a click outside closes it.
	interface Props {
		x: number;
		y: number;
		path: string;
		icon: ProjectIcon;
		color: ProjectColor;
		onClose: () => void;
	}
	let { x, y, path, icon, color, onClose }: Props = $props();

	let el = $state<HTMLDivElement>();
	let left = $state(0);
	let top = $state(0);

	$effect(() => {
		if (!el) return;
		const rect = el.getBoundingClientRect();
		left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
		top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
	});

	$effect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (el && !el.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey);
		window.addEventListener('resize', onClose);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('resize', onClose);
		};
	});
</script>

<div class="picker" role="dialog" aria-label="Project icon and color" style="left: {left}px; top: {top}px" bind:this={el}>
	<div class="icons">
		{#each PROJECT_ICONS as i (i)}
			<button
				class="icon"
				class:on={i === icon}
				style:color={i === icon ? colorVar(color) : undefined}
				title={i.replaceAll('_', ' ')}
				onclick={() => void styleProject(path, { icon: i })}
			>
				<span class="material-symbols-outlined fill">{i}</span>
			</button>
		{/each}
	</div>
	<div class="colors">
		{#each PROJECT_COLORS as c (c)}
			<button
				class="color"
				class:on={c === color}
				style:background={colorVar(c)}
				title={c}
				aria-label={c}
				onclick={() => void styleProject(path, { color: c })}
			></button>
		{/each}
	</div>
</div>

<style>
	.picker {
		position: fixed;
		z-index: 1000;
		width: 236px;
		padding: 8px;
		background: var(--raise);
		border: 1px solid var(--line-2);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
	}
	.icons {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 2px;
	}
	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.icon .material-symbols-outlined {
		font-size: 18px;
	}
	.icon:hover {
		background: var(--hover);
		color: var(--text);
	}
	.icon.on {
		background: var(--press);
	}
	.colors {
		display: flex;
		gap: 7px;
		margin-top: 8px;
		padding: 10px 2px 2px;
		border-top: 1px solid var(--line-2);
	}
	.color {
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		border-radius: 50%;
		cursor: pointer;
	}
	.color.on {
		outline: 2px solid var(--text);
		outline-offset: 2px;
	}
</style>
