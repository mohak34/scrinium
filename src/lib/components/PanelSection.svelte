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

<section aria-label={title}>
	<header>
		<span class="material-symbols-outlined">{icon}</span>
		<span class="title">{title}</span>
		{#if count}<span class="count">{count}</span>{/if}
		<span class="sp"></span>
		{@render action?.()}
	</header>
	{@render children()}
</section>

<style>
	section {
		padding: 10px 12px 8px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 7px;
		height: 28px;
		padding: 0 4px;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	header .material-symbols-outlined {
		font-size: 18px;
		color: var(--text-3);
	}
	.count {
		color: var(--text-3);
		font-weight: 400;
	}
	.sp {
		flex: 1;
	}
</style>
