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
	import ShortcutHelp from '$lib/components/ShortcutHelp.svelte';
	import { get } from 'svelte/store';
	import {
		paletteOpen,
		pageCommands,
		shortcutHelpOpen,
		leaderPending,
		isTyping
	} from '$lib/stores/palette';
	import { startCreate } from '$lib/stores/actions';
	import { settings } from '$lib/stores/settings';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { APPS } from '$lib/apps';
	import { flushSave } from '$lib/stores/vault';

	let { children } = $props();

	const appChrome = () =>
		!page.url.pathname.startsWith('/login') && !page.url.pathname.startsWith('/s/');

	// Space leader: two-key commands (Space then a key), on every app page.
	// p opens the palette and n / N create a note / folder anywhere; other
	// keys come from the page's commands. Times out after a second so a
	// stray Space never leaves the app armed.
	let leaderTimer: ReturnType<typeof setTimeout> | undefined;

	function startLeader() {
		leaderPending.set(true);
		clearTimeout(leaderTimer);
		leaderTimer = setTimeout(() => leaderPending.set(false), 1000);
	}

	function clearLeader() {
		leaderPending.set(false);
		clearTimeout(leaderTimer);
	}

	function runLeader(key: string) {
		if (key === ' ' || key === 'p') paletteOpen.set(true);
		else if (key === 'n') void startCreate('note');
		else if (key === 'N') void startCreate('folder');
		else get(pageCommands).find((c) => c.leader === key)?.run();
	}

	// The help overlay is modal: it swallows keys in the capture phase, like
	// the settings dialog, so nothing fires underneath; Esc closes it. Focus
	// stays where it was (the editor, say), so every default is blocked too:
	// no typing into it behind the overlay, and it is still there on close.
	function helpKey(e: KeyboardEvent) {
		if (!get(shortcutHelpOpen)) return;
		e.stopPropagation();
		e.preventDefault();
		if (e.key === 'Escape' || e.key === '?') shortcutHelpOpen.set(false);
	}

	// Plain-key shortcuts with vim motions on: Space leader and ? help. They
	// only fire outside text inputs, so typing is never hijacked, and never
	// over the palette. A page that owns the key (an open image preview, say)
	// claims it with preventDefault in the capture phase.
	function vimKey(e: KeyboardEvent) {
		if (!appChrome()) return;
		const blocked = e.defaultPrevented || isTyping(e.target) || get(paletteOpen);
		if (get(leaderPending)) {
			clearLeader();
			// A modifier combo aborts the leader and falls through to its
			// own handler; Esc just cancels.
			if (e.key === 'Escape') e.preventDefault();
			if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Escape' || blocked) return;
			e.preventDefault();
			runLeader(e.key);
			return;
		}
		if (!get(settings).editor.vimMotions || e.metaKey || e.ctrlKey || e.altKey || blocked) return;
		if (e.key === '?') {
			e.preventDefault();
			shortcutHelpOpen.set(true);
		} else if (e.key === ' ') {
			// Space keeps its native behaviour on controls (buttons use it
			// to activate); the leader only starts from dead areas.
			const t = e.target;
			if (t instanceof Element && t.closest('button, a, [role="button"]')) return;
			e.preventDefault();
			startLeader();
		}
	}

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
		window.addEventListener('keydown', vimKey);
		window.addEventListener('keydown', helpKey, true);
		return () => {
			window.removeEventListener('contextmenu', block);
			window.removeEventListener('keydown', jump);
			window.removeEventListener('keydown', vimKey);
			window.removeEventListener('keydown', helpKey, true);
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
	{#if $shortcutHelpOpen}
		<ShortcutHelp onClose={() => shortcutHelpOpen.set(false)} />
	{/if}
	{#if $leaderPending}
		<div class="leader" role="status">Space…</div>
	{/if}
{/if}

<style>
	.leader {
		position: fixed;
		left: 12px;
		bottom: 12px;
		z-index: 940;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius);
		box-shadow: var(--shadow-pop);
		color: var(--on-surface-variant);
		font-family: var(--font-mono);
		font-size: var(--font-ui-small);
		padding: 4px 10px;
	}
</style>
