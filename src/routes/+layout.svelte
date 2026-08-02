<script lang="ts">
	import { onMount } from 'svelte';

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
		* {
			box-sizing: border-box;
		}
		html,
		body {
			margin: 0;
			height: 100%;
			background: #14151a;
		}
	</style>
</svelte:head>

{@render children()}
