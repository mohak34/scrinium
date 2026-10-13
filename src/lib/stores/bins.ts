import { writable } from 'svelte/store';

export type BinTab = 'archive' | 'trash' | 'review' | 'unused';

// The full-page Archive / Trash / Review / Unused files view (root layout), or closed when
// null. focus is a note to select when the view opens: its original path
// (a wikilink to an archived note) or its ".archive/..." path (a task link).
export const binView = writable<{ tab: BinTab; focus?: string } | null>(null);

export const openBins = (tab: BinTab = 'archive', focus?: string) => binView.set({ tab, focus });
