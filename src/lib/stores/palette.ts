import { writable } from 'svelte/store';

// The Ctrl+K palette lives in the root layout so it opens on every app page.
// Its global commands are built in; a page adds its own (editor formatting on
// Notes, view switches on Board) by setting pageCommands while it is mounted.
export interface PaletteCommand {
	label: string;
	hint: string;
	run: () => void;
}

export const paletteOpen = writable(false);
export const pageCommands = writable<PaletteCommand[]>([]);

// Register a page's commands for as long as the page is mounted. Call from
// onMount and return the result as its cleanup. The cleanup only clears its
// own list, so it can't wipe the next page's if that mounted first.
export function usePageCommands(cmds: PaletteCommand[]): () => void {
	pageCommands.set(cmds);
	return () => pageCommands.update((cur) => (cur === cmds ? [] : cur));
}
