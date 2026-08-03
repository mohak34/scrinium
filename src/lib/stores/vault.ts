import { writable, get } from 'svelte/store';

export interface VaultEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	children?: VaultEntry[];
}

export const tree = writable<VaultEntry[]>([]);
export const activePath = writable<string | null>(null);
export const saveStatus = writable<'idle' | 'saving' | 'saved' | 'error'>('idle');

// Open tabs, oldest first. The active note is the last one opened (or the
// neighbour chosen by closeTab) - activePath stays the single source of truth.
export const openTabs = writable<string[]>([]);

export function openTab(path: string) {
	openTabs.update((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
	activePath.set(path);
}

export function closeTab(path: string) {
	const tabs = get(openTabs);
	const idx = tabs.indexOf(path);
	if (idx === -1) return;
	const remaining = tabs.filter((t) => t !== path);
	openTabs.set(remaining);
	if (get(activePath) === path) {
		const next = remaining[Math.min(idx, remaining.length - 1)] ?? null;
		activePath.set(next);
	}
}

const encPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export interface SearchResult {
	path: string;
	title: string;
	snippet: string;
}

export async function searchNotes(q: string): Promise<SearchResult[]> {
	const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
	if (!res.ok) return [];
	return res.json();
}

export async function loadTree() {
	const res = await fetch('/api/tree');
	if (res.ok) tree.set(await res.json());
}

export async function loadNote(path: string): Promise<string> {
	const res = await fetch(`/api/notes/${encPath(path)}`);
	if (!res.ok) throw new Error('Failed to load note');
	return res.text();
}

let pendingSave: { path: string; content: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSave(path: string, content: string) {
	pendingSave = { path, content };
	saveStatus.set('saving');
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		void doSave();
	}, 500);
}

async function doSave() {
	if (!pendingSave) return;
	const { path, content } = pendingSave;
	pendingSave = null;
	clearTimeout(saveTimer);
	try {
		const res = await fetch(`/api/notes/${encPath(path)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/plain' },
			body: content
		});
		saveStatus.set(res.ok ? 'saved' : 'error');
		if (res.ok) loadTree();
	} catch {
		saveStatus.set('error');
	}
}

// Finish saving the current note immediately. Call before switching notes or
// leaving the page so the debounce can never drop unsaved keystrokes.
export async function flushSave() {
	if (pendingSave) await doSave();
}

export async function createNote(path: string) {
	await fetch(`/api/notes/${encPath(path)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'text/plain' },
		body: `# ${path.replace(/\.md$/, '').split('/').pop()}\n\n`
	});
	await loadTree();
}

export async function createFolder(path: string) {
	await fetch(`/api/notes/${encPath(path)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder: true })
	});
	await loadTree();
}

export async function renamePath(oldPath: string, newPath: string): Promise<boolean> {
	const res = await fetch(`/api/notes/${encPath(oldPath)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ newPath })
	});
	await loadTree();
	return res.ok;
}

export async function deletePath(path: string) {
	await fetch(`/api/notes/${encPath(path)}`, { method: 'DELETE' });
	await loadTree();
	const current = get(activePath);
	if (current && (current === path || current.startsWith(path + '/'))) {
		activePath.set(null);
	}
	openTabs.update((tabs) => tabs.filter((t) => t !== path && !t.startsWith(path + '/')));
}

// Drag-and-drop move: same fs.rename underneath, but the target is a folder
// (or null for the vault root) and the basename is preserved. Keeps the open
// note's editor pinned to the note when it (or an ancestor folder) moves.
export async function movePath(from: string, toDir: string | null): Promise<boolean> {
	const name = from.split('/').pop()!;
	const newPath = toDir ? `${toDir}/${name}` : name;
	if (newPath === from) return true;
	const res = await fetch(`/api/notes/${encPath(from)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ newPath })
	});
	await loadTree();
	const current = get(activePath);
	if (current && (current === from || current.startsWith(from + '/'))) {
		activePath.set(newPath + current.slice(from.length));
	}
	openTabs.update((tabs) =>
		tabs.map((t) => {
			if (t === from) return newPath;
			if (t.startsWith(from + '/')) return newPath + t.slice(from.length);
			return t;
		})
	);
	return res.ok;
}
