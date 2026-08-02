import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = env.DATABASE_PATH || './data/scrinium.db';

// Make sure the parent directory exists before sqlite tries to open the file
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Lightweight metadata cache for the sidebar/search. This is a CACHE, not a
// source of truth - if it ever gets out of sync with the vault, delete the
// rows and let the app rescan the folder on disk.
db.exec(`
	CREATE TABLE IF NOT EXISTS note_meta (
		path TEXT PRIMARY KEY,
		title TEXT,
		updated_at INTEGER
	);
`);

export function upsertNoteMeta(relPath: string, title: string, updatedAt: number) {
	db.prepare(
		`INSERT INTO note_meta (path, title, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
	).run(relPath, title, updatedAt);
}

export function deleteNoteMeta(relPath: string) {
	db.prepare(`DELETE FROM note_meta WHERE path = ?`).run(relPath);
}

export function deleteNoteMetaByPrefix(relPath: string) {
	db.prepare(`DELETE FROM note_meta WHERE path = ? OR path LIKE ?`).run(relPath, `${relPath}/%`);
}

export function renameNoteMeta(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT path FROM note_meta WHERE path = ? OR path LIKE ?`)
		.all(oldPath, `${oldPath}/%`) as { path: string }[];
	for (const row of rows) {
		const renamed = newPath + row.path.slice(oldPath.length);
		db.prepare(`UPDATE note_meta SET path = ? WHERE path = ?`).run(renamed, row.path);
	}
}

export function listNoteMeta() {
	return db.prepare(`SELECT path, title, updated_at FROM note_meta ORDER BY updated_at DESC`).all();
}
