import { writable } from 'svelte/store';

// Cross-component "please start creating a note/folder here" signal. Set by the
// command palette (and anything else) to hand the action to the sidebar, which
// owns the inline create inputs. The sidebar consumes it and resets it to null.
export const createRequest = writable<{ parent: string | null; kind: 'note' | 'folder' } | null>(
	null
);

// Bumped to ask the sidebar's search box to take focus (command palette action).
export const focusSearchRequest = writable(0);

// "Please start an inline rename for this path" signal. Set by the top bar
// (and anything else) to hand the action to the sidebar's file tree, which
// owns the inline rename input. The sidebar consumes it and resets it to null.
export const renameRequest = writable<{ path: string } | null>(null);

// Bumped to ask the sidebar's trash view to open (command palette action).
export const openTrashRequest = writable(0);

