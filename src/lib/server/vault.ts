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

export async function ensureVaultExists() {
	await fs.mkdir(VAULT_DIR, { recursive: true });
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

export async function writeNote(relPath: string, content: string): Promise<void> {
	const fullPath = safeResolve(relPath);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, content, 'utf-8');
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
	const dest = path.join(TRASH_DIR, `${Date.now()}-${path.basename(fullPath)}`);
	await fs.rename(fullPath, dest);
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
