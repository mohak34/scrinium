<script lang="ts">
	import { onMount } from 'svelte';
	import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
	import '@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css';
	import '@fontsource-variable/space-grotesk';
	import '@fontsource-variable/jetbrains-mono';
	import '@material-symbols/font-400';
	import '$lib/design/theme.css';
	import ReminderToasts from '$lib/components/ReminderToasts.svelte';
	import SettingsDialog from '$lib/components/settings/SettingsDialog.svelte';
	import BinsView from '$lib/components/bins/BinsView.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import { paletteOpen } from '$lib/stores/palette';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { APPS } from '$lib/apps';
	import { flushSave } from '$lib/stores/vault';

	let { children } = $props();

	const appChrome = () =>
		!page.url.pathname.startsWith('/login') && !page.url.pathname.startsWith('/s/');

	onMount(() => {
		// Kill the browser's native right-click menu everywhere - Scrinium
		// has its own custom context menus, and the editor treats right-click
		// as an app-level action.
		// Public share pages keep it so readers can long-press links on phones.
		const block = (e: MouseEvent) => {
			if (!page.url.pathname.startsWith('/s/')) e.preventDefault();
		};
		window.addEventListener('contextmenu', block);

		// Ctrl+K toggles the command palette and Ctrl+Shift+1..4 jumps between
		// Notes, Tasks, Board and Calendar, from any app page. Plain Ctrl+digit
		// is taken (editor headings, browser tabs). Public share and login
		// pages have neither.
		const jump = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey || !appChrome()) return;
			if (!e.shiftKey && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				paletteOpen.update((v) => !v);
				return;
			}
			const n = /^Digit([1-4])$/.exec(e.code)?.[1];
			if (!e.shiftKey || !n) return;
			e.preventDefault();
			void flushSave().then(() => goto(APPS[Number(n) - 1].href));
		};
		window.addEventListener('keydown', jump);
		return () => {
			window.removeEventListener('contextmenu', block);
			window.removeEventListener('keydown', jump);
		};
	});
</script>

<!-- The app shell scrolls its own panes. Share pages are documents and
scroll the page, which phones need for native scrolling and pinch zoom. -->
<svelte:head>
	{#if !page.url.pathname.startsWith('/s/')}
		<style>
			html,
			body {
				height: 100%;
				overflow: hidden;
			}
		</style>
	{/if}
</svelte:head>

{@render children()}
<ReminderToasts />
{#if appChrome()}
	<SettingsDialog />
	<BinsView />
	{#if $paletteOpen}
		<CommandPalette onClose={() => paletteOpen.set(false)} />
	{/if}
{/if}
