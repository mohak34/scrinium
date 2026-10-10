<script lang="ts">
	import { onMount } from 'svelte';
	import TaskDrawer from '$lib/components/TaskDrawer.svelte';
	import { loadProjects, loadTasks } from '$lib/stores/tasks';

	// Shared frame for Tasks, Board and Calendar: the page on the left, the
	// task drawer docked on the right while a task is open. Each page owns
	// its own header (with the app switcher as its title).
	let { children } = $props();

	// Tasks also change from other tabs, the phone and agents (MCP): reload
	// when this tab comes back into view.
	onMount(() => {
		void loadProjects();
		const again = () => {
			if (document.visibilityState !== 'visible') return;
			void loadTasks();
			void loadProjects();
		};
		document.addEventListener('visibilitychange', again);
		window.addEventListener('focus', again);
		return () => {
			document.removeEventListener('visibilitychange', again);
			window.removeEventListener('focus', again);
		};
	});
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
