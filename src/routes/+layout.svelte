<script lang="ts">
	let { children } = $props();
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
