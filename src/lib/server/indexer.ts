import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { deleteNoteIndexByPrefix, indexNote, indexedMtime, indexedPaths } from './db';
import { effectiveTitle } from '$lib/editor/frontmatter';

const VAULT_DIR = path.resolve(env.VAULT_DIR || './vault');

let scan: Promise<void> | undefined;
let scannedAt = 0;
const RESCAN_AFTER = 30_000;

// Scans the vault so search sees notes edited, added or deleted outside
// the app (a text editor, sync, git). The first search waits for the
// first scan; later searches start a fresh one in the background at most
// every 30 s, so results catch up without slowing the query. A file whose
// mtime matches the one it was indexed at is skipped unread, so a scan is
// mostly stats. The archive is scanned too, under its ".archive/..."
// paths, so archive search works; plain search filters it out.
export async function ensureIndex() {
	if (!scan) {
		scan = run();
		return scan;
	}
	if (scannedAt && Date.now() - scannedAt > RESCAN_AFTER) {
		scannedAt = 0;
		scan = run();
	}
}

async function run() {
	try {
		await walkAndIndex(VAULT_DIR, '');
		await walkAndIndex(path.join(VAULT_DIR, '.archive'), '.archive');
		// Rows whose file is gone (deleted or moved outside the app). The
		// check and delete are synchronous, so an app write can't land
		// between them.
		for (const p of indexedPaths()) {
			if (!existsSync(path.join(VAULT_DIR, p))) deleteNoteIndexByPrefix(p);
		}
	} finally {
		scannedAt = Date.now();
	}
}

async function walkAndIndex(dir: string, rel: string) {
	let dirents;
	try {
		dirents = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const dirent of dirents) {
		if (dirent.name.startsWith('.')) continue;
		const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
		const full = path.join(dir, dirent.name);
		if (dirent.isDirectory()) {
			await walkAndIndex(full, childRel);
		} else if (dirent.isFile() && /\.md$/i.test(dirent.name)) {
			try {
				const { mtimeMs } = await fs.stat(full);
				if (indexedMtime(childRel) === mtimeMs) continue;
				const body = await fs.readFile(full, 'utf-8');
				// Moved (trashed, archived, renamed) during the read: its
				// bookkeeping already ran, so a row now would be stale. The
				// check and insert are synchronous, so nothing moves between.
				if (!existsSync(full)) continue;
				const title = effectiveTitle(body, childRel);
				indexNote(childRel, title, body, mtimeMs);
			} catch {
				// Skip unreadable files - they'll surface again on a later scan.
			}
		}
	}
}
