import { writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { flushSave } from './vault';

// Cross-component "please start creating a note/folder here" signal. Set by the
// command palette (and anything else) to hand the action to the sidebar, which
// owns the inline create inputs. The sidebar consumes it and resets it to null.
export const createRequest = writable<{ parent: string | null; kind: 'note' | 'folder' } | null>(
	null
);

// Start an inline create at the vault root from any page: Notes owns the
// sidebar, so other pages switch to it first.
export async function startCreate(kind: 'note' | 'folder') {
	createRequest.set({ parent: null, kind });
	if (page.url.pathname === '/') return;
	await flushSave();
	await goto('/');
}

// Bumped to ask the sidebar's search box to take focus (command palette action).
export const focusSearchRequest = writable(0);

// Set to a tag name (without `#`) to run it as a vault search. Set by the
// rail Tags panel; the sidebar search box consumes it and resets to null.
export const searchTagRequest = writable<string | null>(null);

// "Please start an inline rename for this path" signal. Set by the top bar
// (and anything else) to hand the action to the sidebar's file tree, which
// owns the inline rename input. The sidebar consumes it and resets it to null.
export const renameRequest = writable<{ path: string } | null>(null);

