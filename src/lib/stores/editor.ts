import { writable } from 'svelte/store';

// Caret position of the open note, 1-based, for the status bar readout.
export const cursorPos = writable({ line: 1, col: 1 });
