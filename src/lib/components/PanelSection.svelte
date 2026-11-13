<script lang="ts">
	import type { Snippet } from 'svelte';

	// One titled block of the note's right panel: icon, name, optional count
	// and an optional trailing action (an add button, say).
	interface Props {
		icon: string;
		title: string;
		count?: number;
		action?: Snippet;
		children: Snippet;
	}
	let { icon, title, count, action, children }: Props = $props();
</script>

<section class="well" aria-label={title}>
	<header>
		<span class="material-symbols-outlined">{icon}</span>
		<span class="title">{title}</span>
		{#if count}<span class="count">{count}</span>{/if}
		<span class="sp"></span>
		{@render action?.()}
	</header>
	<div class="well-body">{@render children()}</div>
</section>

<style>
	section {
		flex-shrink: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 6px 0 8px;
		color: var(--text-2);
		font: 500 var(--t-meta) var(--font-ui);
	}
	header .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.count {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-3);
		font-size: var(--t-micro);
		line-height: 18px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.sp {
		flex: 1;
	}
</style>
