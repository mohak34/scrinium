import { writable } from 'svelte/store';

// Vim mode shared between the editor (which observes it) and the tab bar
// (which displays it left of the save dot).
export type VimChromeMode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'visual-block' | 'replace';

export const VIM_MODE_LABEL: Record<VimChromeMode, string> = {
	normal: 'NORMAL',
	insert: 'INSERT',
	visual: 'VISUAL',
	'visual-line': 'V-LINE',
	'visual-block': 'V-BLOCK',
	replace: 'REPLACE'
};

export const vimMode = writable<VimChromeMode>('insert');
