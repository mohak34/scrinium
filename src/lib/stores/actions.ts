import { writable } from 'svelte/store';

// Cross-component "please start creating a note/folder here" signal. Set by the
// command palette (and anything else) to hand the action to the sidebar, which
// owns the inline create inputs. The sidebar consumes it and resets it to null.
export const createRequest = writable<{ parent: string | null; kind: 'note' | 'folder' } | null>(
	null
);
