<script lang="ts">
	import type { Snippet } from 'svelte';
	import AppActions from './AppActions.svelte';

	// Bottom strip for Tasks, Board and Calendar, matching the notes status bar.
	// `actions` puts Trash/Settings/Sign out at the left on pages without a sidebar.
	let { children, actions = false }: { children: Snippet; actions?: boolean } = $props();
</script>

<footer>
	{#if actions}<span class="actions"><AppActions /></span>{/if}
	<span class="sp"></span>
	{@render children()}
</footer>

<style>
	footer {
		height: 26px;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 0 14px;
		border-top: 1px solid var(--line);
		background: var(--panel);
		color: var(--text-3);
		font-size: var(--fs-xs);
		flex-shrink: 0;
		white-space: nowrap;
	}
	.sp {
		flex: 1;
	}
	.actions {
		display: flex;
		gap: 2px;
		margin-left: -8px;
	}
	footer :global(.red) {
		color: var(--red);
	}
</style>
