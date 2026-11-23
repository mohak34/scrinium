<script lang="ts">
	import type { Snippet } from 'svelte';
	import AppActions from './AppActions.svelte';
	import ReminderBell from './ReminderBell.svelte';

	// Bottom strip for Tasks, Board and Calendar, matching the notes status bar.
	// `actions` puts the account menu at the left on pages without a sidebar.
	let { children, actions = false }: { children?: Snippet; actions?: boolean } = $props();
</script>

<footer>
	{#if actions}<AppActions />{/if}
	<span class="sp"></span>
	<ReminderBell />
	{@render children?.()}
</footer>

<style>
	footer {
		height: 34px;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 0 6px;
		color: var(--text-3);
		font-size: var(--t-caption);
		flex-shrink: 0;
		white-space: nowrap;
	}
	.sp {
		flex: 1;
	}
	footer :global(.red) {
		color: var(--red);
	}
</style>
