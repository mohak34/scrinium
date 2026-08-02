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

const encPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

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

export async function renamePath(oldPath: string, newPath: string) {
	await fetch(`/api/notes/${encPath(oldPath)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ newPath })
	});
	await loadTree();
}

export async function deletePath(path: string) {
	await fetch(`/api/notes/${encPath(path)}`, { method: 'DELETE' });
	await loadTree();
	const current = get(activePath);
	if (current && (current === path || current.startsWith(path + '/'))) {
		activePath.set(null);
	}
}
