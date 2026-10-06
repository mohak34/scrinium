import { writable, get } from 'svelte/store';
import { linkFirstMention } from '$lib/editor/wikilinks';
import { effectiveTitle, setEffectiveTitle, updateFrontmatterBlock } from '$lib/editor/frontmatter';
import type { Document } from 'yaml';

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

// Unsaved note text by path. One entry per note, so a failed save for one
// note is never overwritten by edits to another.
const pending = new Map<string, string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Saves run one at a time: an older PUT can never land after a newer one.
let saving: Promise<void> = Promise.resolve();
let retryMs = 0;

export function scheduleSave(path: string, content: string) {
	pending.set(path, content);
	saveStatus.set('saving');
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => void doSave(), 500);
}

// Write every pending note. A failed write goes back in the queue (unless
// newer text for that note arrived meanwhile) and retries with backoff, so a
// network blip shows "error" but never drops keystrokes. keepalive lets the
// request outlive a closing tab (browsers cap those bodies near 64 KB).
function doSave(keepalive = false): Promise<void> {
	saving = saving.then(async () => {
		clearTimeout(saveTimer);
		let failed = false;
		for (const [path, content] of [...pending]) {
			pending.delete(path);
			let ok = false;
			try {
				const res = await fetch(`/api/notes/${encPath(path)}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'text/plain' },
					body: content,
					keepalive: keepalive && content.length < 60000
				});
				ok = res.ok;
			} catch {}
			if (!ok) {
				failed = true;
				if (!pending.has(path)) pending.set(path, content);
			}
		}
		if (failed) {
			saveStatus.set('error');
			retryMs = Math.min(retryMs ? retryMs * 2 : 2000, 30000);
			saveTimer = setTimeout(() => void doSave(), retryMs);
			return;
		}
		retryMs = 0;
		if (pending.size === 0) saveStatus.set('saved');
		void loadTree();
	});
	return saving;
}

// Finish saving immediately. Call before switching notes, renaming, moving,
// deleting or leaving the page so the debounce can never drop keystrokes.
export async function flushSave(keepalive = false) {
	await doSave(keepalive);
}

// Pending text follows a rename so a late save never recreates the old file.
function remapPending(from: string, to: string) {
	for (const [path, content] of [...pending]) {
		if (path !== from && !path.startsWith(from + '/')) continue;
		pending.delete(path);
		pending.set(to + path.slice(from.length), content);
	}
}

// Set when a rename moves the open note, so the page keeps the editor as is
// (cursor, undo, keystrokes typed during the request) instead of reloading.
let activeRename: { from: string; to: string } | null = null;

export function takeActiveRename(from: string | null, to: string | null): boolean {
	const hit = !!activeRename && activeRename.from === from && activeRename.to === to;
	activeRename = null;
	return hit;
}

// --- Title <-> filename sync ---

export function extractTitle(content: string, fallback = ''): string | null {
	// Frontmatter-aware: a `title:` key wins, else the first body `# `
	// heading. Never the `---` fence - that rename bug is why this helper
	// exists. Empty means "nothing to sync", as before.
	const title = effectiveTitle(content, fallback);
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
		// Rewrite the same source the sync reads (fm `title:` key when the
		// block owns one, else the body heading); null means no target.
		const curTitle = effectiveTitle(content, '');
		if (curTitle === newBase) return;
		const newContent = setEffectiveTitle(content, newBase);
		if (!newContent) return;
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

// Rewrite the note's frontmatter block via a mutate callback (set/delete
// keys). Creates the block when missing, drops it when emptied. Flushes
// first so debounced keystrokes are never clobbered; pushes into the
// editor when the note is open.
export async function updateFrontmatter(
	path: string,
	mutate: (doc: Document) => void
): Promise<boolean> {
	await flushSave();
	let content: string;
	try {
		content = await loadNote(path);
	} catch {
		return false;
	}
	const next = updateFrontmatterBlock(content, mutate);
	if (!next || next === content) return false;
	const res = await fetch(`/api/notes/${encPath(path)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'text/plain' },
		body: next
	});
	if (!res.ok) return false;
	if (get(activePath) === path) {
		externalContentUpdate.set({ path, content: next });
	}
	await loadTree();
	return true;
}
// Convert the first bare mention of the target note into a `[[link]]`
// inside the source file. Flushes first so debounced keystrokes are never
// clobbered; pushes into the editor when the source is the open note.
export async function linkUnlinkedMention(sourcePath: string, targetPath: string): Promise<boolean> {
	await flushSave();
	let content: string;
	try {
		content = await loadNote(sourcePath);
	} catch {
		return false;
	}
	const next = linkFirstMention(content, targetPath);
	if (!next) return false;
	const res = await fetch(`/api/notes/${encPath(sourcePath)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'text/plain' },
		body: next
	});
	if (!res.ok) return false;
	if (get(activePath) === sourcePath) {
		externalContentUpdate.set({ path: sourcePath, content: next });
	}
	await loadTree();
	return true;
}

// Centralized rename/move that keeps tabs/activePath/pinned and pending
// saves in sync. Callers still handle filetree collapsed state via renameDir.
export async function renameNote(oldPath: string, newPath: string): Promise<boolean> {
	if (oldPath === newPath) return true;
	await flushSave();
	const res = await fetch(`/api/notes/${encPath(oldPath)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ newPath })
	}).catch(() => null);
	const ok = !!res?.ok;
	if (ok) {
		remapPending(oldPath, newPath);
		const current = get(activePath);
		if (current && (current === oldPath || current.startsWith(oldPath + '/'))) {
			const next = newPath + current.slice(oldPath.length);
			activeRename = { from: current, to: next };
			activePath.set(next);
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
	await loadTree();
	return ok;
}

export async function deletePath(path: string) {
	// Save first so the trashed copy has the latest text.
	await flushSave();
	const res = await fetch(`/api/notes/${encPath(path)}`, { method: 'DELETE' }).catch(() => null);
	await loadTree();
	if (!res?.ok) return;
	// Keystrokes typed while the request ran must not recreate the file.
	for (const p of [...pending.keys()]) if (p === path || p.startsWith(path + '/')) pending.delete(p);
	const current = get(activePath);
	if (current && (current === path || current.startsWith(path + '/'))) {
		activePath.set(null);
	}
	openTabs.update((tabs) => tabs.filter((t) => t !== path && !t.startsWith(path + '/')));
}

// Drag-and-drop move: a rename whose target is a folder (or null for the
// vault root) with the basename kept.
export async function movePath(from: string, toDir: string | null): Promise<boolean> {
	const name = from.split('/').pop()!;
	return renameNote(from, toDir ? `${toDir}/${name}` : name);
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
