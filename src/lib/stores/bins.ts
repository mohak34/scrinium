import { writable } from 'svelte/store';

export type BinTab = 'archive' | 'trash' | 'review';

// The full-page Archive / Trash / Review view (root layout), or closed when
// null. focus names an archive item (or an original note path inside one)
// to select when the view opens, e.g. from a wikilink to an archived note.
export const binView = writable<{ tab: BinTab; focus?: string } | null>(null);

export const openBins = (tab: BinTab = 'archive', focus?: string) => binView.set({ tab, focus });
