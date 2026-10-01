<script lang="ts">
	import TaskDrawer from '$lib/components/TaskDrawer.svelte';

	// Shared frame for Tasks, Board and Calendar: the page on the left, the
	// task drawer docked on the right while a task is open. Each page owns
	// its own header (with the app switcher as its title).
	let { children } = $props();
</script>

<div class="shell">
	<div class="content">
		{@render children()}
	</div>
	<TaskDrawer />
</div>

<style>
	.shell {
		height: 100vh;
		display: flex;
		background: var(--bg);
		color: var(--text);
	}
	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
</style>
