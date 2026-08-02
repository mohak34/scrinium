import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { indexNote } from './db';

const VAULT_DIR = path.resolve(env.VAULT_DIR || './vault');

let done = false;

// One-time scan of the vault so notes that were never saved through the app
// (or were indexed before this feature existed) still show up in search.
// Runs lazily on the first search request; afterwards individual writes keep
// the FTS index up to date.
export async function ensureIndex() {
	if (done) return;
	done = true;
	await walkAndIndex(VAULT_DIR, '');
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
		} else if (dirent.name.endsWith('.md')) {
			try {
				const body = await fs.readFile(full, 'utf-8');
				const title =
					body.split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 200) || childRel;
				indexNote(childRel, title, body);
			} catch {
				// Skip unreadable files - they'll surface again on a later scan.
			}
		}
	}
}
