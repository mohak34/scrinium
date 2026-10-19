import { writable, get } from 'svelte/store';
import { movedBy, relinkNote } from '$lib/relink';
import { linkFirstMention } from '$lib/editor/wikilinks';
import { effectiveTitle, setEffectiveTitle, updateFrontmatterBlock } from '$lib/editor/frontmatter';
import type { Document } from 'yaml';
import type { ArchiveEntry } from '$lib/archive';

export interface VaultEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	children?: VaultEntry[];
}

export const tree = writable<VaultEntry[]>([]);
export const activePath = writable<string | null>(null);
export const saveStatus = writable<'idle' | 'saving' | 'saved' | 'error'>('idle');

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

// Drag onto the Pinned list: pin `path` (or move it if already pinned) to sit
// before `before`, or last when null.
export function movePin(path: string, before: string | null) {
	pinnedPaths.update((paths) => {
		const rest = paths.filter((p) => p !== path);
		const at = before === null ? -1 : rest.indexOf(before);
		if (at === -1) return [...rest, path];
		return [...rest.slice(0, at), path, ...rest.slice(at)];
	});
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

// Full-text search. The archive is left out unless scope asks for it.
// An aborted signal rejects the promise.
export async function searchNotes(
	q: string,
	scope: 'vault' | 'archive' | 'all' = 'vault',
	signal?: AbortSignal
): Promise<SearchResult[]> {
	const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&scope=${scope}`, { signal });
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
// autosave debounce first so the file includes the latest keystrokes; a
// failed save aborts rather than download a stale copy.
export async function downloadNote(path: string) {
	if (!(await flushSave())) return;
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
// One queue for saves and for changes that depend on saved text (rename,
// delete, content rewrites): an older PUT can never land after a newer one,
// and a save never runs while a path change is in flight.
let queue: Promise<unknown> = Promise.resolve();
let retryMs = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
	const run = queue.then(fn);
	queue = run.catch(() => {});
	return run;
}

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
// Only call from inside the queue.
async function writePending(keepalive = false): Promise<boolean> {
	clearTimeout(saveTimer);
	let failed = false;
	for (const path of [...pending.keys()]) {
		// Read the text now, not from a snapshot: edits typed while an
		// earlier note's PUT was in flight are the ones to send.
		const content = pending.get(path);
		if (content === undefined) continue;
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
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void doSave(), retryMs);
		return false;
	}
	retryMs = 0;
	if (pending.size === 0) saveStatus.set('saved');
	return true;
}

function doSave(keepalive = false): Promise<boolean> {
	return enqueue(() => writePending(keepalive));
}

// Finish saving immediately. Call before switching notes or leaving the page
// so the debounce can never drop keystrokes. Resolves false when a write
// failed: the text stays queued for retry, but the server copy is stale.
export function flushSave(keepalive = false): Promise<boolean> {
	return doSave(keepalive);
}

// Run a change that reads or moves saved notes inside the queue: pending
// text is written first and saves scheduled meanwhile wait for it to finish.
// Resolves null without running fn when a write failed, so the change never
// acts on a stale server copy. fn must not call flushSave (it would wait on
// itself).
function afterSaved<T>(fn: () => Promise<T>): Promise<T | null> {
	return enqueue(async () => ((await writePending()) ? fn() : null));
}

// Pending text follows a rename so a late save never recreates the old file,
// and gets the relative-link fix the server gave the saved copies, so it
// never writes the old links back.
function remapPending(from: string, to: string) {
	const moved = movedBy(from, to);
	for (const [path, content] of [...pending]) {
		pending.delete(path);
		pending.set(moved(path), relinkNote(content, path, moved(path), moved));
	}
}

// The page's editor. `shown` is the note whose text it holds: it lags
// activePath while the next note loads, so keystrokes save to the note they
// were typed into, and it follows renames, so the editor is never reloaded
// for a note it already shows.
export interface EditorHost {
	// Put a loaded note in the editor; false when it is no longer wanted.
	show(path: string, content: string): boolean;
	// The editor's live text, and a replacement autosaved like typing.
	read(): string;
	write(content: string): void;
}
let editorHost: EditorHost | null = null;
let shown: string | null = null;

export function attachEditor(host: EditorHost): () => void {
	editorHost = host;
	return () => {
		if (editorHost !== host) return;
		editorHost = null;
		shown = null;
	};
}

export function shownNote(): string | null {
	return shown;
}

export function hideNote() {
	shown = null;
}

// Load a note into the editor: its unsaved text when a save failed, else
// the server copy. Runs in the queue, so no write of the note is in flight
// and text that failed to save is back in pending before it is read. Skipped
// when the user moved on before it ran. A failed load of the note still
// selected switches back to the note the editor holds (or none), so the
// chrome never names a note whose keystrokes save elsewhere. Never rejects.
export function showNote(path: string): Promise<void> {
	return enqueue(async () => {
		if (get(activePath) !== path) return;
		await writePending();
		let content = pending.get(path);
		if (content === undefined) {
			try {
				content = await loadNote(path);
			} catch (e) {
				console.error(e);
				if (get(activePath) !== path) return;
				if (shown) openTab(shown);
				else activePath.set(null);
				return;
			}
		}
		if (editorHost?.show(path, content)) shown = path;
	});
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
	// No usable title, or it already matches the filename: drop any rename
	// queued for an earlier heading so a reverted edit is never applied.
	const base = path.split('/').pop()!.replace(/\.md$/, '');
	const sanitized = title && sanitizeTitleForFilename(title);
	if (!sanitized || sanitized === base) {
		if (pendingTitleSync?.path === path) cancelTitleSync();
		return;
	}
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

// Rewrite the renamed note's title (fm `title:` key when the block owns
// one, else the body heading) to match its new filename.
export async function syncFilenameToTitle(oldPath: string, newPath: string) {
	if (!newPath.endsWith('.md')) return;
	const newBase = newPath.split('/').pop()!.replace(/\.md$/, '');
	const ok = await rewriteNote(newPath, (content) =>
		effectiveTitle(content, '') === newBase ? null : setEffectiveTitle(content, newBase)
	);
	// A title sync queued before the rename would rename it back.
	if (ok && shown === newPath) cancelTitleSync();
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

// Apply a content rewrite to a note's latest text. The note in the editor
// is rewritten there and autosaved like typing, so text typed while the
// rewrite waited is kept and later keystrokes keep the rewrite; any other
// note is read and written back in the queue. Runs after saved text and
// resolves false when a save failed or nothing changed.
async function rewriteNote(path: string, next: (content: string) => string | null): Promise<boolean> {
	const ok = await afterSaved(async () => {
		const host = shown === path ? editorHost : null;
		if (host) {
			const content = host.read();
			const out = next(content);
			if (!out || out === content) return false;
			host.write(out);
			return true;
		}
		let content: string;
		try {
			content = await loadNote(path);
		} catch {
			return false;
		}
		const out = next(content);
		if (!out || out === content) return false;
		const res = await fetch(`/api/notes/${encPath(path)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/plain' },
			body: out
		}).catch(() => null);
		return !!res?.ok;
	});
	if (ok) await loadTree();
	return !!ok;
}

// Rewrite the note's frontmatter block via a mutate callback (set/delete
// keys). Creates the block when missing, drops it when emptied.
export function updateFrontmatter(path: string, mutate: (doc: Document) => void): Promise<boolean> {
	return rewriteNote(path, (content) => updateFrontmatterBlock(content, mutate));
}

// Convert the first bare mention of the target note into a `[[link]]`
// inside the source file.
export function linkUnlinkedMention(sourcePath: string, targetPath: string): Promise<boolean> {
	return rewriteNote(sourcePath, (content) => linkFirstMention(content, targetPath));
}

// Centralized rename/move that keeps tabs/activePath/pinned and pending
// saves in sync. Callers still handle filetree collapsed state via renameDir.
// Runs in the save queue: nothing is renamed while a save fails, and text
// typed during the request waits, then follows the rename (or stays on the
// old path when the rename fails).
export async function renameNote(oldPath: string, newPath: string): Promise<boolean> {
	if (oldPath === newPath) return true;
	const ok = await afterSaved(async () => {
		const res = await fetch(`/api/notes/${encPath(oldPath)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newPath })
		}).catch(() => null);
		if (!res?.ok) return false;
		remapPending(oldPath, newPath);
		const moved = movedBy(oldPath, newPath);
		const before = shown;
		if (shown) shown = moved(shown);
		// The server fixed the relative links the move broke; the open note
		// gets the same fix in its live text (which may hold links typed
		// during the request), autosaved like typing, so the next save never
		// puts the old links back.
		if (before && shown && editorHost) {
			const text = editorHost.read();
			const out = relinkNote(text, before, shown, moved);
			if (out !== text) editorHost.write(out);
		}
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
		return true;
	});
	await loadTree();
	return !!ok;
}

// Move a note or folder out of the vault: to the trash (DELETE) or the
// archive. Runs in the save queue, so the moved copy has every keystroke
// saved first; a failed save keeps the note and its queued text. Text
// typed while the request is in flight is dropped on success (the note is
// gone; saving it would recreate the file) and saved to the still-existing
// note on failure.
function putAway(path: string, send: () => Promise<Response>): Promise<boolean> {
	return afterSaved(async () => {
		const res = await send().catch(() => null);
		if (!res?.ok) return false;
		for (const p of [...pending.keys()]) if (p === path || p.startsWith(path + '/')) pending.delete(p);
		if (shown && (shown === path || shown.startsWith(path + '/'))) shown = null;
		const current = get(activePath);
		if (current && (current === path || current.startsWith(path + '/'))) {
			activePath.set(null);
		}
		openTabs.update((tabs) => tabs.filter((t) => t !== path && !t.startsWith(path + '/')));
		pinnedPaths.update((pinned) => pinned.filter((p) => p !== path && !p.startsWith(path + '/')));
		return true;
	}).then((ok) => !!ok);
}

export async function deletePath(path: string) {
	const ok = await putAway(path, () => fetch(`/api/notes/${encPath(path)}`, { method: 'DELETE' }));
	await loadTree();
	if (ok) void loadTrash();
	return ok;
}

export async function archivePath(path: string) {
	const ok = await putAway(path, () =>
		fetch('/api/archive', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path })
		})
	);
	await loadTree();
	if (ok) void loadArchive();
	return ok;
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
	if (restoredPath?.endsWith('.md')) openTab(restoredPath);
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

// --- Archive ---

export const archiveEntries = writable<ArchiveEntry[]>([]);

export async function loadArchive() {
	const res = await fetch('/api/archive');
	if (res.ok) archiveEntries.set(await res.json());
}

const postJson = (url: string, body: unknown) =>
	fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Back to its original path (or "name (1)" when taken), opened in a tab
// when it is a note. Resolves the path it landed on, null on failure.
export async function unarchive(name: string): Promise<string | null> {
	const res = await postJson('/api/archive/restore', { name }).catch(() => null);
	if (!res?.ok) return null;
	const path: unknown = (await res.json().catch(() => null))?.path;
	await Promise.all([loadTree(), loadArchive()]);
	if (typeof path !== 'string') return null;
	if (path.endsWith('.md')) openTab(path);
	return path;
}

export async function archiveToTrash(name: string): Promise<boolean> {
	const res = await postJson('/api/archive/trash', { name }).catch(() => null);
	await Promise.all([loadArchive(), loadTrash()]);
	return !!res?.ok;
}
