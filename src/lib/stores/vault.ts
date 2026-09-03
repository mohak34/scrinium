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

// For external edits (e.g. filename->title sync) to push new content into the editor
// without the editor thinking it is a user edit.
export const externalContentUpdate = writable<{ path: string; content: string } | null>(null);

// Pinned notes, kept client-side (a display preference, not vault state).
// Pinned entries sort first in the tree at every level.
const PIN_STORAGE = 'scrinium:pinned';
// Guarded on window so SSR never touches Node's experimental localStorage.
function loadPinned(): string[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(PIN_STORAGE);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
	} catch {
		return [];
	}
}
export const pinnedPaths = writable<string[]>(loadPinned());
pinnedPaths.subscribe((paths) => {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(PIN_STORAGE, JSON.stringify(paths));
	} catch {
		// storage full/blocked - pinning still works for this session
	}
});

export function togglePin(path: string) {
	pinnedPaths.update((paths) =>
		paths.includes(path) ? paths.filter((p) => p !== path) : [...paths, path]
	);
}

// Sort a level of the tree so pinned entries come first, preserving the
// existing alphabetical/type order within each group.
export function sortPinnedFirst(entries: VaultEntry[]): VaultEntry[] {
	let pinned: VaultEntry[] = [];
	let rest: VaultEntry[] = [];
	for (const e of entries) {
		if (get(pinnedPaths).includes(e.path)) pinned.push(e);
		else rest.push(e);
	}
	return [...pinned, ...rest];
}

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

// Download the note as a plain `.md` file through the browser. Flushes the
// autosave debounce first so the file includes the latest keystrokes.
export async function downloadNote(path: string) {
	await flushSave();
	const content = await loadNote(path);
	const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = path.split('/').pop() ?? 'note.md';
		document.body.appendChild(a);
		a.click();
		a.remove();
	} finally {
		URL.revokeObjectURL(url);
	}
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

// --- Title <-> filename sync ---

export function extractTitle(content: string): string | null {
	const first = content.split('\n')[0] ?? '';
	const m = first.match(/^#\s+(.+?)\s*$/);
	if (!m) return null;
	const title = m[1].trim();
	return title || null;
}

export function sanitizeTitleForFilename(title: string): string | null {
	let name = title.trim().replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '').trim();
	if (!name || name === '.' || name === '..' || name.startsWith('.')) return null;
	// Cap length to keep filesystem happy
	if (name.length > 100) name = name.slice(0, 100).trim();
	return name;
}

let pendingTitleSync: { path: string; title: string } | null = null;
let titleSyncTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleTitleSync(path: string, content: string) {
	if (!path.endsWith('.md')) return;
	const title = extractTitle(content);
	if (!title) return;
	// Avoid scheduling if title already matches filename (sanitized)
	const base = path.split('/').pop()!.replace(/\.md$/, '');
	const sanitized = sanitizeTitleForFilename(title);
	if (!sanitized || sanitized === base) return;
	pendingTitleSync = { path, title };
	clearTimeout(titleSyncTimer);
	titleSyncTimer = setTimeout(() => {
		void executeTitleSync();
	}, 900);
}

async function executeTitleSync() {
	const pending = pendingTitleSync;
	pendingTitleSync = null;
	clearTimeout(titleSyncTimer);
	if (!pending) return;
	await flushSave();
	const sanitized = sanitizeTitleForFilename(pending.title);
	if (!sanitized) return;
	const dir = pending.path.includes('/') ? pending.path.slice(0, pending.path.lastIndexOf('/')) : null;
	const newPath = dir ? `${dir}/${sanitized}.md` : `${sanitized}.md`;
	if (newPath === pending.path) return;
	const ok = await renameNote(pending.path, newPath);
	if (!ok) saveStatus.set('error');
}

export function cancelTitleSync() {
	clearTimeout(titleSyncTimer);
	pendingTitleSync = null;
}

export async function syncFilenameToTitle(oldPath: string, newPath: string) {
	if (!newPath.endsWith('.md')) return;
	const newBase = newPath.split('/').pop()!.replace(/\.md$/, '');
	try {
		const res = await fetch(`/api/notes/${encPath(newPath)}`);
		if (!res.ok) return;
		let content = await res.text();
		const lines = content.split('\n');
		if (!lines[0]?.match(/^#\s+/)) return;
		const curTitle = lines[0].replace(/^#\s+/, '').trim();
		if (curTitle === newBase) return;
		lines[0] = `# ${newBase}`;
		const newContent = lines.join('\n');
		const putRes = await fetch(`/api/notes/${encPath(newPath)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/plain' },
			body: newContent
		});
		if (putRes.ok) {
			await loadTree();
			// Push to editor if this is the active note
			if (get(activePath) === newPath) {
				externalContentUpdate.set({ path: newPath, content: newContent });
				// also clear any pending title sync that would try to rename back
				cancelTitleSync();
			}
		}
	} catch {}
}

// --- New note defaults ---

function getNewNoteTemplate(title: string): string {
	// Minimal default: H1 + blank line. Kept in localStorage so it can be
	// extended via a future settings UI without changing the vault contract.
	if (typeof window === 'undefined') return `# ${title}\n\n`;
	try {
		const raw = localStorage.getItem('scrinium:newNoteTemplate');
		if (raw && typeof raw === 'string' && raw.includes('{{title}}')) {
			return raw.replaceAll('{{title}}', title);
		}
	} catch {}
	return `# ${title}\n\n`;
}

export async function createNote(path: string) {
	const base = path.replace(/\.md$/, '').split('/').pop() ?? 'Untitled';
	const body = getNewNoteTemplate(base);
	await fetch(`/api/notes/${encPath(path)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'text/plain' },
		body
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

// Centralized rename that keeps tabs/activePath/pinned in sync.
// Callers still handle filetree collapsed state via renameDir.
export async function renameNote(oldPath: string, newPath: string): Promise<boolean> {
	if (oldPath === newPath) return true;
	const res = await fetch(`/api/notes/${encPath(oldPath)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ newPath })
	});
	await loadTree();
	if (res.ok) {
		const current = get(activePath);
		if (current && (current === oldPath || current.startsWith(oldPath + '/'))) {
			activePath.set(newPath + current.slice(oldPath.length));
		}
		openTabs.update((tabs) =>
			tabs.map((t) => {
				if (t === oldPath) return newPath;
				if (t.startsWith(oldPath + '/')) return newPath + t.slice(oldPath.length);
				return t;
			})
		);
		pinnedPaths.update((pinned) =>
			pinned.map((p) => {
				if (p === oldPath) return newPath;
				if (p.startsWith(oldPath + '/')) return newPath + p.slice(oldPath.length);
				return p;
			})
		);
	}
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

// --- Trash ---

export interface TrashEntry {
	trashName: string;
	originalPath: string;
	deletedAt: number;
	isDir: boolean;
	size?: number;
}

export const trashEntries = writable<TrashEntry[]>([]);

export async function loadTrash() {
	const res = await fetch('/api/trash');
	if (res.ok) trashEntries.set(await res.json());
}

export async function restoreTrash(trashName: string): Promise<string | null> {
	const res = await fetch('/api/trash/restore', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ trashName })
	});
	if (!res.ok) return null;
	const data = await res.json().catch(() => null);
	const restoredPath = typeof data?.path === 'string' ? data.path : null;
	await loadTree();
	await loadTrash();
	if (restoredPath) openTab(restoredPath);
	return restoredPath;
}

export async function purgeTrash(trashName: string) {
	await fetch(`/api/trash?trashName=${encodeURIComponent(trashName)}`, { method: 'DELETE' });
	await loadTrash();
}

export async function emptyTrash() {
	await fetch('/api/trash?all=1', { method: 'DELETE' });
	await loadTrash();
}
