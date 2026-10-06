import { env } from '$env/dynamic/private';
import fs from 'node:fs/promises';
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

export async function readNote(relPath: string): Promise<string> {
	const fullPath = safeResolve(relPath);
	try {
		return await fs.readFile(fullPath, 'utf-8');
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw error(404, 'Note not found');
		throw e;
	}
}

export async function writeAsset(relPath: string, data: Buffer): Promise<void> {
	const fullPath = safeResolve(relPath);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, data);
}

export async function readAsset(relPath: string): Promise<Buffer> {
	const fullPath = safeResolve(relPath);
	try {
		return await fs.readFile(fullPath);
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw error(404, 'Not found');
		throw e;
	}
}

// Write to a temp file beside the note, then rename over it: a crash or a
// full disk mid-write leaves the old note intact instead of a truncated one.
export async function writeNote(relPath: string, content: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	const tmp = path.join(path.dirname(fullPath), `.${path.basename(fullPath)}.${process.pid}.${Date.now()}.tmp`);
	try {
		await fs.writeFile(tmp, content, 'utf-8');
		await fs.rename(tmp, fullPath);
	} catch (e) {
		await fs.rm(tmp, { force: true });
		throw e;
	}
}

export async function createFolder(relPath: string): Promise<void> {
	await fs.mkdir(safeResolve(relPath), { recursive: true });
}

export async function renamePath(oldRelPath: string, newRelPath: string): Promise<void> {
	const from = safeResolve(oldRelPath);
	const to = safeResolve(newRelPath);
	if (from === to) return;
	try {
		await fs.access(to);
		throw error(409, 'Target already exists');
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
	await fs.rename(from, to);
}

export async function moveToTrash(relPath: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	if (fullPath === VAULT_DIR || fullPath === TRASH_DIR) throw error(400, 'Invalid path');
	await fs.mkdir(TRASH_DIR, { recursive: true });
	const trashName = `${Date.now()}-${path.basename(fullPath)}`;
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

export async function restoreFromTrash(trashName: string): Promise<string> {
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
		// Find a free name like "name (1).md"
		const dir = path.dirname(targetFull);
		const ext = path.extname(targetFull);
		const base = path.basename(targetFull, ext);
		for (let i = 1; i < 100; i++) {
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

export async function purgeFromTrash(trashName: string): Promise<void> {
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
