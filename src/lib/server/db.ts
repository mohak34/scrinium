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

// Full-text search index over note contents (SQLite FTS5). The path column is
// stored but not searchable; title + body are. Rebuilt/updated from the vault
// by the PUT/PATCH/DELETE endpoints and a one-time startup scan.
db.exec(`
	CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
		path UNINDEXED,
		title,
		body,
		tokenize = 'porter unicode61'
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

export function indexNote(relPath: string, title: string, body: string) {
	db.prepare(`DELETE FROM note_fts WHERE path = ?`).run(relPath);
	db.prepare(`INSERT INTO note_fts (path, title, body) VALUES (?, ?, ?)`).run(relPath, title, body);
}

export function deleteNoteIndex(relPath: string) {
	db.prepare(`DELETE FROM note_fts WHERE path = ?`).run(relPath);
}

export function deleteNoteIndexByPrefix(relPath: string) {
	db.prepare(`DELETE FROM note_fts WHERE path = ? OR path LIKE ?`).run(relPath, `${relPath}/%`);
}

export function renameNoteIndex(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT path, title, body FROM note_fts WHERE path = ? OR path LIKE ?`)
		.all(oldPath, `${oldPath}/%`) as { path: string; title: string; body: string }[];
	for (const row of rows) {
		const renamed = newPath + row.path.slice(oldPath.length);
		db.prepare(`DELETE FROM note_fts WHERE path = ?`).run(row.path);
		db.prepare(`INSERT INTO note_fts (path, title, body) VALUES (?, ?, ?)`).run(
			renamed,
			row.title,
			row.body
		);
	}
}

export interface SearchResult {
	path: string;
	title: string;
	snippet: string;
}

export function searchNotes(q: string): SearchResult[] {
	// Quote each whitespace-separated token so arbitrary user input can't break
	// the FTS5 MATCH syntax. A trailing * turns a term into a prefix query, so
	// partial words ("lis") still match whole tokens ("list"). Run both an exact
	// query (preserves porter stemming of whole words) and a prefix query, then
	// merge, keeping exact matches first.
	const tokens = q
		.split(/\s+/)
		.map((t) => t.replace(/^\*+|\*+$|\s+/g, '').replace(/"/g, '""'))
		.filter(Boolean);
	if (!tokens.length) return [];
	const exact = tokens.map((t) => `"${t}"`).join(' ');
	const prefixed = tokens.map((t) => `"${t}"*`).join(' ');

	const rows = db
		.prepare(
			`SELECT path, title, snippet(note_fts, 2, '\u258D', '\u258D', ' \u2026 ', 28) AS snip
			 FROM note_fts WHERE note_fts MATCH ? ORDER BY rank LIMIT 30`
		)
		.all(exact) as { path: string; title: string; snip: string | null }[];
	const extra = db
		.prepare(
			`SELECT path, title, snippet(note_fts, 2, '\u258D', '\u258D', ' \u2026 ', 28) AS snip
			 FROM note_fts WHERE note_fts MATCH ? ORDER BY rank LIMIT 30`
		)
		.all(prefixed) as { path: string; title: string; snip: string | null }[];

	const seen = new Set(rows.map((r) => r.path));
	for (const r of extra) {
		if (seen.has(r.path)) continue;
		rows.push(r);
		seen.add(r.path);
	}
	return rows.slice(0, 30).map((r) => ({
		path: r.path,
		title: r.title,
		snippet: r.snip ?? ''
	}));
}

export function listRecentNotes(limit = 15) {
	return db
		.prepare(`SELECT path, title FROM note_meta ORDER BY updated_at DESC LIMIT ?`)
		.all(limit) as { path: string; title: string }[];
}
