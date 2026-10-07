import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import path from 'node:path';
import { error } from '@sveltejs/kit';

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
export async function writeNote(relPath: string, content: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	return withVaultLock(async () => {
		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		const tmp = path.join(path.dirname(fullPath), `.${path.basename(fullPath)}.${randomUUID()}.tmp`);
		try {
			await fs.writeFile(tmp, content, 'utf-8');
			await fs.rename(tmp, fullPath);
		} catch (e) {
			await fs.rm(tmp, { force: true });
			throw e;
		}
	});
}

export async function createFolder(relPath: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	return withVaultLock(async () => {
		await fs.mkdir(fullPath, { recursive: true });
	});
}

// fs.rename replaces an existing file (or empty folder), so the free check
// and the move must not interleave with other mutations: hold the vault lock.
export async function renamePath(oldRelPath: string, newRelPath: string): Promise<void> {
	const from = safeResolve(oldRelPath);
	const to = safeResolve(newRelPath);
	if (from === to) return;
	return withVaultLock(async () => {
		if (await exists(to)) throw error(409, 'Target already exists');
		await fs.rename(from, to);
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

export function moveToTrash(relPath: string): Promise<void> {
	return withVaultLock(() => trash(relPath));
}

async function trash(relPath: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	if (fullPath === VAULT_DIR || fullPath === TRASH_DIR) throw error(400, 'Invalid path');
	await fs.mkdir(TRASH_DIR, { recursive: true });
	// Bump the stamp if a same-named note was trashed in the same millisecond,
	// keeping the "<number>-<name>" shape listTrash falls back on.
	let stamp = Date.now();
	while (await exists(path.join(TRASH_DIR, `${stamp}-${path.basename(fullPath)}`))) stamp++;
	const trashName = `${stamp}-${path.basename(fullPath)}`;
	const dest = path.join(TRASH_DIR, trashName);
	await fs.rename(fullPath, dest);
	// Record original location so we can restore. Index is best-effort; a missing
	// entry just means restore falls back to vault root.
	try {
		const idx = await readTrashIndex();
		let isDir = false;
		try {
			const st = await fs.stat(dest);
			isDir = st.isDirectory();
		} catch {}
		idx[trashName] = { originalPath: relPath, deletedAt: Date.now(), isDir };
		await writeTrashIndex(idx);
	} catch {}
}

const TRASH_INDEX = path.join(TRASH_DIR, '.index.json');

export interface TrashEntry {
	trashName: string;
	originalPath: string;
	deletedAt: number;
	isDir: boolean;
	size?: number;
}

type TrashIndex = Record<string, { originalPath: string; deletedAt: number; isDir: boolean }>;

async function readTrashIndex(): Promise<TrashIndex> {
	try {
		const raw = await fs.readFile(TRASH_INDEX, 'utf-8');
		const parsed = JSON.parse(raw) as TrashIndex;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

async function writeTrashIndex(idx: TrashIndex): Promise<void> {
	await fs.mkdir(TRASH_DIR, { recursive: true });
	const tmp = `${TRASH_INDEX}.tmp-${Date.now()}`;
	await fs.writeFile(tmp, JSON.stringify(idx, null, 2), 'utf-8');
	await fs.rename(tmp, TRASH_INDEX);
}

export async function listTrash(): Promise<TrashEntry[]> {
	await fs.mkdir(TRASH_DIR, { recursive: true });
	const idx = await readTrashIndex();
	const dirents = await fs.readdir(TRASH_DIR, { withFileTypes: true }).catch(() => []);
	const entries: TrashEntry[] = [];
	for (const d of dirents) {
		if (d.name === '.index.json' || d.name.startsWith('.index.json.tmp')) continue;
		if (d.name.startsWith('.')) continue;
		const meta = idx[d.name];
		let size: number | undefined;
		try {
			const st = await fs.stat(path.join(TRASH_DIR, d.name));
			size = st.isDirectory() ? undefined : st.size;
		} catch {}
		entries.push({
			trashName: d.name,
			originalPath: meta?.originalPath ?? d.name.replace(/^\d+-/, ''),
			deletedAt: meta?.deletedAt ?? 0,
			isDir: meta?.isDir ?? d.isDirectory(),
			size
		});
	}
	entries.sort((a, b) => b.deletedAt - a.deletedAt);
	return entries;
}

export function restoreFromTrash(trashName: string): Promise<string> {
	return withVaultLock(() => restore(trashName));
}

async function restore(trashName: string): Promise<string> {
	if (!trashName || trashName.includes('/') || trashName.includes('\\') || trashName.startsWith('.'))
		throw error(400, 'Invalid trash name');
	const src = path.join(TRASH_DIR, trashName);
	try {
		await fs.access(src);
	} catch {
		throw error(404, 'Not in trash');
	}
	const idx = await readTrashIndex();
	const meta = idx[trashName];
	const originalPath = meta?.originalPath ?? trashName.replace(/^\d+-/, '');
	let targetRel = originalPath;
	// If original location now exists, pick a free name instead of overwriting.
	let targetFull = safeResolve(targetRel);
	try {
		await fs.access(targetFull);
		// Find a free name like "name (1).md"; never fall through to the taken original.
		const dir = path.dirname(targetFull);
		const ext = path.extname(targetFull);
		const base = path.basename(targetFull, ext);
		for (let i = 1; ; i++) {
			const candBase = `${base} (${i})${ext}`;
			const candRel = targetRel.includes('/')
				? `${targetRel.slice(0, targetRel.lastIndexOf('/'))}/${candBase}`
				: candBase;
			const candFull = safeResolve(candRel);
			try {
				await fs.access(candFull);
				continue;
			} catch (e: unknown) {
				if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
					targetRel = candRel;
					targetFull = candFull;
					break;
				}
				throw e;
			}
		}
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
	await fs.mkdir(path.dirname(targetFull), { recursive: true });
	await fs.rename(src, targetFull);
	delete idx[trashName];
	try {
		await writeTrashIndex(idx);
	} catch {}
	return targetRel;
}

export function purgeFromTrash(trashName: string): Promise<void> {
	return withVaultLock(() => purge(trashName));
}

async function purge(trashName: string): Promise<void> {
	if (!trashName || trashName.includes('/') || trashName.includes('\\') || trashName.startsWith('.'))
		throw error(400, 'Invalid trash name');
	const full = path.join(TRASH_DIR, trashName);
	// Ensure the path stays inside TRASH_DIR
	const resolved = path.resolve(full);
	if (resolved !== TRASH_DIR && !resolved.startsWith(TRASH_DIR + path.sep)) throw error(400, 'Invalid path');
	try {
		await fs.rm(full, { recursive: true, force: true });
	} catch {}
	const idx = await readTrashIndex();
	if (trashName in idx) {
		delete idx[trashName];
		try {
			await writeTrashIndex(idx);
		} catch {}
	}
}

export async function emptyTrash(): Promise<void> {
	const entries = await listTrash();
	for (const e of entries) {
		await purgeFromTrash(e.trashName);
	}
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
