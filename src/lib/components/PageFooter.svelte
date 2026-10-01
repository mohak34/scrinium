<script lang="ts">
	import type { Snippet } from 'svelte';

	// Bottom strip for Tasks, Board and Calendar, matching the notes status bar.
	let { children }: { children: Snippet } = $props();
</script>

<footer>
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
	footer :global(.red) {
		color: var(--red);
	}
</style>
