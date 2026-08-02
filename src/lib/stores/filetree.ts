import { writable } from 'svelte/store';

export const collapsedDirs = writable<Set<string>>(new Set());

export function toggleDir(path: string) {
	collapsedDirs.update((s) => {
		const next = new Set(s);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		return next;
	});
}

export function expandDir(path: string) {
	collapsedDirs.update((s) => {
		if (!s.has(path)) return s;
		const next = new Set(s);
		next.delete(path);
		return next;
	});
}
