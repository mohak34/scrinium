import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream, statSync, type ReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { movedBy, relinkNote } from '$lib/relink';

const VAULT_DIR = path.resolve(env.VAULT_DIR || './vault');
const TRASH_DIR = path.join(VAULT_DIR, '.trash');

export interface VaultEntry {
	name: string;
	path: string; // relative path from vault root, always forward-slash
	type: 'file' | 'directory';
	children?: VaultEntry[];
}

/**
 * Resolves a relative path from the client against the vault root and
 * guarantees the result stays inside VAULT_DIR. Throws a 400 otherwise.
 * This is the ONLY function that should turn client-provided paths into
 * real filesystem paths - never build fs paths anywhere else.
 */
export function safeResolve(relPath: string): string {
	const cleaned = relPath.replace(/^\/+/, '');
	const resolved = path.resolve(VAULT_DIR, cleaned);
	if (resolved !== VAULT_DIR && !resolved.startsWith(VAULT_DIR + path.sep)) {
		throw error(400, 'Invalid path');
	}
	return resolved;
}

// The canonical vault-relative form of a path ("./P/" and "/P" are "P").
export function vaultRel(relPath: string): string {
	return path.relative(VAULT_DIR, safeResolve(relPath)).split(path.sep).join('/');
}

export function isFolder(relPath: string): boolean {
	try {
		return statSync(safeResolve(relPath)).isDirectory();
	} catch {
		return false;
	}
}

// Every vault mutation (write, mkdir, rename, trash, restore, purge) runs one
// at a time through this in-process queue. Renames and restores check that the
// target is free and then move onto it; without the queue a concurrent write or
// rename can land on that target in between and get overwritten. Locked
// functions must never call each other, or the queue deadlocks.
let vaultQueue: Promise<unknown> = Promise.resolve();
function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
	const run = vaultQueue.then(fn);
	vaultQueue = run.catch(() => {});
	return run;
}

export async function readNote(relPath: string): Promise<string> {
	const fullPath = safeResolve(relPath);
	try {
		return await fs.readFile(fullPath, 'utf-8');
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw error(404, 'Note not found');
		throw e;
	}
}

/**
 * Streams an upload into `dir` under `name` without holding it in memory:
 * chunks go to a hidden temp file and abort past `maxBytes`. The finished
 * file is hard-linked into place under the vault lock (the slow stream
 * stays outside it), so a clash never overwrites; it retries
 * as `name-1.ext`, `name-2.ext`, ... Returns the vault-relative path.
 */
export async function writeAssetStream(
	dir: string,
	name: string,
	body: ReadableStream<Uint8Array>,
	maxBytes: number
): Promise<string> {
	const fullDir = safeResolve(dir);
	await fs.mkdir(fullDir, { recursive: true });
	const tmp = path.join(fullDir, `.upload.${randomUUID()}.tmp`);
	let size = 0;
	try {
		await pipeline(
			Readable.fromWeb(body as WebReadableStream<Uint8Array>),
			async function* (chunks: AsyncIterable<Uint8Array>) {
				for await (const chunk of chunks) {
					size += chunk.byteLength;
					if (size > maxBytes) throw error(413, `File too large (max ${maxBytes / 1024 / 1024} MB)`);
					yield chunk;
				}
			},
			createWriteStream(tmp, { flags: 'wx' })
		);
		if (size === 0) throw error(400, 'Empty file');
		const ext = path.extname(name);
		const stem = name.slice(0, name.length - ext.length);
		return await withVaultLock(async () => {
			for (let n = 0; ; n++) {
				const candidate = n ? `${stem}-${n}${ext}` : name;
				try {
					await fs.link(tmp, path.join(fullDir, candidate));
					return dir ? `${dir}/${candidate}` : candidate;
				} catch (e: unknown) {
					if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
				}
			}
		});
	} finally {
		await fs.rm(tmp, { force: true });
	}
}

// Opens a vault file for streaming out; 404 for missing files and folders.
export async function openAsset(relPath: string): Promise<{ stream: ReadStream; size: number }> {
	const fullPath = safeResolve(relPath);
	try {
		const stat = await fs.stat(fullPath);
		if (!stat.isFile()) throw error(404, 'Not found');
		return { stream: createReadStream(fullPath), size: stat.size };
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw error(404, 'Not found');
		throw e;
	}
}

// Write to a temp file beside the note, then rename over it: a crash or a
// full disk mid-write leaves the old note intact instead of a truncated one.
// The temp name is random so concurrent writes to one note never share it.
// Callers hold the vault lock.
async function writeAtomic(fullPath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	const tmp = path.join(path.dirname(fullPath), `.${path.basename(fullPath)}.${randomUUID()}.tmp`);
	try {
		await fs.writeFile(tmp, content, 'utf-8');
		await fs.rename(tmp, fullPath);
	} catch (e) {
		await fs.rm(tmp, { force: true });
		throw e;
	}
}

export async function writeNote(relPath: string, content: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	return withVaultLock(() => writeAtomic(fullPath, content));
}

export async function createFolder(relPath: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	return withVaultLock(async () => {
		await fs.mkdir(fullPath, { recursive: true });
	});
}

// fs.rename replaces an existing file (or empty folder), so the free check
// and the move must not interleave with other mutations: hold the vault lock.
// Relative links that the move broke are fixed in the same lock, in the
// moved notes and in every note linking into the move (a whole-vault scan,
// like backlinks). Resolves the notes it rewrote, under their new paths.
export async function renamePath(
	oldRelPath: string,
	newRelPath: string
): Promise<{ path: string; content: string }[]> {
	const from = safeResolve(oldRelPath);
	const to = safeResolve(newRelPath);
	if (from === to) return [];
	return withVaultLock(async () => {
		if (await exists(to)) throw error(409, 'Target already exists');
		await fs.rename(from, to);
		const [was, now] = [vaultRel(oldRelPath), vaultRel(newRelPath)];
		const moved = movedBy(was, now);
		const back = movedBy(now, was);
		const changed: { path: string; content: string }[] = [];
		for (const n of await readNotesUnder('')) {
			const out = relinkNote(n.content, back(n.path), n.path, moved);
			if (out === n.content) continue;
			await writeAtomic(safeResolve(n.path), out);
			changed.push({ path: n.path, content: out });
		}
		return changed;
	});
}

async function exists(full: string): Promise<boolean> {
	try {
		await fs.access(full);
		return true;
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw e;
	}
}

// Trash and archive are both bins: a dot folder in the vault holding each
// moved-out note or folder as "<stamp>-<name>", plus .index.json recording
// where it came from. The tree, tags, backlinks and manifest skip dot
// folders, so a binned item leaves the vault view untouched. Emptying the
// trash never reaches the archive.
export type Bin = 'trash' | 'archive';
const BIN_DIRS: Record<Bin, string> = { trash: TRASH_DIR, archive: path.join(VAULT_DIR, '.archive') };

// Vault-relative path of a bin item, e.g. ".archive/1712-Ideas.md".
export const binPath = (bin: Bin, name: string) => `.${bin}/${name}`;

// True for a path inside any dot folder (bins, uploads in flight). Notes and
// shares never write there: bins change only through the functions below.
export function isHiddenPath(relPath: string): boolean {
	return vaultRel(relPath).split('/').some((s) => s.startsWith('.'));
}

export interface BinEntry {
	name: string;
	originalPath: string;
	// When it entered the bin; 0 when the index lost it.
	movedAt: number;
	isDir: boolean;
	size?: number;
}

// deletedAt is the field older trash indexes wrote.
type BinIndex = Record<string, { originalPath: string; movedAt?: number; deletedAt?: number; isDir: boolean }>;

const indexFile = (bin: Bin) => path.join(BIN_DIRS[bin], '.index.json');

async function readBinIndex(bin: Bin): Promise<BinIndex> {
	try {
		const parsed = JSON.parse(await fs.readFile(indexFile(bin), 'utf-8')) as BinIndex;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

async function writeBinIndex(bin: Bin, idx: BinIndex): Promise<void> {
	await fs.mkdir(BIN_DIRS[bin], { recursive: true });
	const tmp = `${indexFile(bin)}.tmp-${Date.now()}`;
	await fs.writeFile(tmp, JSON.stringify(idx, null, 2), 'utf-8');
	await fs.rename(tmp, indexFile(bin));
}

// A bin item name from a client: one plain segment inside the bin.
function binItem(bin: Bin, name: string): string {
	if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) throw error(400, 'Invalid name');
	return path.join(BIN_DIRS[bin], name);
}

// Bump the stamp if a same-named item landed in the same millisecond,
// keeping the "<number>-<name>" shape listBin falls back on.
async function freeBinName(bin: Bin, base: string): Promise<string> {
	let stamp = Date.now();
	while (await exists(path.join(BIN_DIRS[bin], `${stamp}-${base}`))) stamp++;
	return `${stamp}-${base}`;
}

// Moves a vault note or folder into a bin and returns its entry.
export function moveToBin(bin: Bin, relPath: string): Promise<BinEntry> {
	return withVaultLock(async () => {
		const rel = vaultRel(relPath);
		if (!rel || isHiddenPath(rel)) throw error(400, 'Invalid path');
		const fullPath = safeResolve(rel);
		const st = await fs.stat(fullPath).catch(() => null);
		if (!st) throw error(404, 'Not found');
		await fs.mkdir(BIN_DIRS[bin], { recursive: true });
		const name = await freeBinName(bin, path.basename(fullPath));
		await fs.rename(fullPath, path.join(BIN_DIRS[bin], name));
		const entry = { name, originalPath: rel, movedAt: Date.now(), isDir: st.isDirectory() };
		// Best-effort: without its entry an item restores to the vault root.
		try {
			const idx = await readBinIndex(bin);
			idx[name] = { originalPath: rel, movedAt: entry.movedAt, isDir: entry.isDir };
			await writeBinIndex(bin, idx);
		} catch {}
		return entry;
	});
}

export async function listBin(bin: Bin): Promise<BinEntry[]> {
	const dir = BIN_DIRS[bin];
	await fs.mkdir(dir, { recursive: true });
	const idx = await readBinIndex(bin);
	const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
	const entries: BinEntry[] = [];
	for (const d of dirents) {
		if (d.name.startsWith('.')) continue;
		const meta = idx[d.name];
		let size: number | undefined;
		try {
			const st = await fs.stat(path.join(dir, d.name));
			size = st.isDirectory() ? undefined : st.size;
		} catch {}
		entries.push({
			name: d.name,
			originalPath: meta?.originalPath ?? d.name.replace(/^\d+-/, ''),
			movedAt: meta?.movedAt ?? meta?.deletedAt ?? 0,
			isDir: meta?.isDir ?? d.isDirectory(),
			size
		});
	}
	entries.sort((a, b) => b.movedAt - a.movedAt);
	return entries;
}

// path is where the item landed: originalPath, or "name (1)" when that is
// taken. movedAt is null for items missing from the index.
export interface Restored {
	path: string;
	originalPath: string;
	movedAt: number | null;
	// The .md notes that came back with their text, read under the lock so
	// the caller can reindex them before any later move can take them.
	notes: { path: string; content: string }[];
}

// Every .md note at or under a vault path ('' is the whole vault), with its
// text. Dot folders inside are skipped.
export async function readNotesUnder(rel: string): Promise<{ path: string; content: string }[]> {
	const full = safeResolve(rel);
	const st = await fs.stat(full).catch(() => null);
	if (!st?.isDirectory()) {
		const content = st && rel.endsWith('.md') ? await fs.readFile(full, 'utf-8').catch(() => null) : null;
		return content === null ? [] : [{ path: rel, content }];
	}
	const out: { path: string; content: string }[] = [];
	for (const d of await fs.readdir(full, { withFileTypes: true }).catch(() => [])) {
		if (!d.name.startsWith('.')) out.push(...(await readNotesUnder(rel ? `${rel}/${d.name}` : d.name)));
	}
	return out;
}

export function restoreFromBin(bin: Bin, name: string): Promise<Restored> {
	return withVaultLock(async () => {
		const src = binItem(bin, name);
		if (!(await exists(src))) throw error(404, `Not in ${bin}`);
		const idx = await readBinIndex(bin);
		const meta = idx[name];
		const originalPath = meta?.originalPath ?? name.replace(/^\d+-/, '');
		// Never overwrite: a taken original becomes "name (1).md", "name (2).md", ...
		const ext = path.extname(originalPath);
		const stem = originalPath.slice(0, originalPath.length - ext.length);
		let targetRel = originalPath;
		for (let i = 1; await exists(safeResolve(targetRel)); i++) targetRel = `${stem} (${i})${ext}`;
		const targetFull = safeResolve(targetRel);
		await fs.mkdir(path.dirname(targetFull), { recursive: true });
		await fs.rename(src, targetFull);
		delete idx[name];
		try {
			await writeBinIndex(bin, idx);
		} catch {}
		return {
			path: targetRel,
			originalPath,
			movedAt: meta?.movedAt ?? meta?.deletedAt ?? null,
			notes: await readNotesUnder(targetRel)
		};
	});
}

// Moves an item from one bin to another (archive to trash), keeping its
// original path so restoring it from the new bin puts it back in the vault.
export function moveBetweenBins(from: Bin, to: Bin, name: string): Promise<BinEntry> {
	return withVaultLock(async () => {
		const src = binItem(from, name);
		const st = await fs.stat(src).catch(() => null);
		if (!st) throw error(404, `Not in ${from}`);
		const fromIdx = await readBinIndex(from);
		const originalPath = fromIdx[name]?.originalPath ?? name.replace(/^\d+-/, '');
		await fs.mkdir(BIN_DIRS[to], { recursive: true });
		const dest = await freeBinName(to, path.basename(originalPath) || name);
		await fs.rename(src, path.join(BIN_DIRS[to], dest));
		const entry = { name: dest, originalPath, movedAt: Date.now(), isDir: st.isDirectory() };
		try {
			delete fromIdx[name];
			await writeBinIndex(from, fromIdx);
			const toIdx = await readBinIndex(to);
			toIdx[dest] = { originalPath, movedAt: entry.movedAt, isDir: entry.isDir };
			await writeBinIndex(to, toIdx);
		} catch {}
		return entry;
	});
}

// Deleting forever only exists for the trash.
export function purgeFromTrash(name: string): Promise<void> {
	return withVaultLock(async () => {
		await fs.rm(binItem('trash', name), { recursive: true, force: true }).catch(() => {});
		const idx = await readBinIndex('trash');
		if (name in idx) {
			delete idx[name];
			try {
				await writeBinIndex('trash', idx);
			} catch {}
		}
	});
}

// Resolves the names it purged, so callers drop only their task links (an
// item trashed meanwhile stays, links and all).
export async function emptyTrash(): Promise<string[]> {
	const names = (await listBin('trash')).map((e) => e.name);
	for (const name of names) await purgeFromTrash(name);
	return names;
}

export interface NoteManifestEntry {
	path: string;
	updatedAt: number;
	contentHash: string;
}

// Metadata-only listing for cheap delta sync (mobile client). Walks the vault
// with stat() only - no file content is read. contentHash is a fingerprint of
// size+mtime; a changed file yields a different hash without hashing bytes.
export async function manifestNotes(): Promise<NoteManifestEntry[]> {
	const entries: NoteManifestEntry[] = [];

	async function walk(relDir: string = '') {
		const fullPath = safeResolve(relDir);
		let dirents;
		try {
			dirents = await fs.readdir(fullPath, { withFileTypes: true });
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
			throw e;
		}
		for (const dirent of dirents) {
			if (dirent.name.startsWith('.')) continue;
			const childRelPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				await walk(childRelPath);
			} else if (dirent.name.endsWith('.md')) {
				const st = await fs.stat(path.join(fullPath, dirent.name));
				entries.push({
					path: childRelPath,
					updatedAt: st.mtimeMs,
					contentHash: `${st.size}:${st.mtimeMs}`
				});
			}
		}
	}

	await walk();
	entries.sort((a, b) => a.path.localeCompare(b.path));
	return entries;
}

export async function listTree(relDir: string = ''): Promise<VaultEntry[]> {
	const fullPath = safeResolve(relDir);
	let dirents;
	try {
		dirents = await fs.readdir(fullPath, { withFileTypes: true });
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw e;
	}

	const entries: VaultEntry[] = [];
	for (const dirent of dirents) {
		if (dirent.name.startsWith('.')) continue; // skip dotfiles/dirs
		const childRelPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;

		if (dirent.isDirectory()) {
			entries.push({
				name: dirent.name,
				path: childRelPath,
				type: 'directory',
				children: await listTree(childRelPath)
			});
		} else {
			entries.push({ name: dirent.name, path: childRelPath, type: 'file' });
		}
	}

	// directories first, then alphabetical
	entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return entries;
}
