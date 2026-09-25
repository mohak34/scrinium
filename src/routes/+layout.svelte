<script lang="ts">
	import { onMount } from 'svelte';
	import '@fontsource-variable/inter';
	import '@material-symbols/font-400';
	import '$lib/design/theme.css';
	import ReminderToasts from '$lib/components/ReminderToasts.svelte';

	let { children } = $props();

	onMount(() => {
		// Kill the browser's native right-click menu everywhere - Scrinium
		// has its own custom context menus, and the editor treats right-click
		// as an app-level action.
		const block = (e: MouseEvent) => e.preventDefault();
		window.addEventListener('contextmenu', block);
		return () => window.removeEventListener('contextmenu', block);
	});
</script>

<svelte:head>
	<style>
		html,
		body {
			height: 100%;
			overflow: hidden;
		}
	</style>
</svelte:head>

{@render children()}
<ReminderToasts />
