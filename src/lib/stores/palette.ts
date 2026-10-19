import { writable } from 'svelte/store';

// The Ctrl+K palette lives in the root layout so it opens on every app page.
// Its global commands are built in; a page adds its own (editor formatting on
// Notes, view switches on Board) by setting pageCommands while it is mounted.
// A command with a leader also runs from Space then that key (vim motions on).
export interface PaletteCommand {
	label: string;
	hint: string;
	leader?: string;
	run: () => void;
}

export const paletteOpen = writable(false);
export const pageCommands = writable<PaletteCommand[]>([]);

// The ? shortcut overlay, also mounted in the root layout.
export const shortcutHelpOpen = writable(false);

// Space was pressed and the next key is a leader command (root layout).
// Pages with their own plain-key shortcuts leave that key alone.
export const leaderPending = writable(false);

// Register a page's commands for as long as the page is mounted. Call from
// onMount and return the result as its cleanup. The cleanup only clears its
// own list, so it can't wipe the next page's if that mounted first.
export function usePageCommands(cmds: PaletteCommand[]): () => void {
	pageCommands.set(cmds);
	return () => pageCommands.update((cur) => (cur === cmds ? [] : cur));
}

// Keys typed here are text, so plain-key shortcuts leave them alone.
export function isTyping(t: EventTarget | null): boolean {
	return (
		t instanceof Element &&
		!!t.closest('input, textarea, select, [contenteditable="true"], .cm-content, .cm-editor')
	);
}
