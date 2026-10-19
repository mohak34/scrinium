import { writable } from 'svelte/store';

// Vault path of the PDF open beside the editor on the notes page, if any.
export const pdfPath = writable<string | null>(null);

export const isPdfPath = (p: string) => /\.pdf$/i.test(p);
