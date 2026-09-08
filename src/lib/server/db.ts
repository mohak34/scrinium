import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import { titleScore } from './rank';

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

export function indexNote(relPath: string, title: string, body: string) {
	db.prepare(`DELETE FROM note_fts WHERE path = ?`).run(relPath);
	db.prepare(`INSERT INTO note_fts (path, title, body) VALUES (?, ?, ?)`).run(relPath, title, body);
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

// Long-lived API tokens for the mobile client. Only the SHA-256 hash is
// stored - the raw token is returned once at issue time and never persisted
// anywhere the server can read back.
db.exec(`
	CREATE TABLE IF NOT EXISTS api_tokens (
		token_hash TEXT PRIMARY KEY,
		user_email TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER
	);
`);

export interface ApiTokenRow {
	token_hash: string;
	user_email: string;
	created_at: number;
	last_used_at: number | null;
}

export function insertApiToken(tokenHash: string, userEmail: string) {
	db.prepare(
		`INSERT INTO api_tokens (token_hash, user_email, created_at) VALUES (?, ?, ?)`
	).run(tokenHash, userEmail.toLowerCase(), Date.now());
}

export function findApiToken(tokenHash: string): ApiTokenRow | undefined {
	return db
		.prepare(`SELECT * FROM api_tokens WHERE token_hash = ?`)
		.get(tokenHash) as ApiTokenRow | undefined;
}

export function touchApiToken(tokenHash: string) {
	db.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?`).run(Date.now(), tokenHash);
}

export function revokeApiToken(tokenHash: string) {
	db.prepare(`DELETE FROM api_tokens WHERE token_hash = ?`).run(tokenHash);
}

export function listApiTokensForEmail(email: string): ApiTokenRow[] {
	return db
		.prepare(`SELECT * FROM api_tokens WHERE user_email = ? ORDER BY created_at DESC`)
		.all(email.toLowerCase()) as ApiTokenRow[];
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
	// merge. Merged rows are re-ranked by titleScore: a title match ("Workbench"
	// for "work") must beat a note that merely mentions the term, and the exact/
	// prefix merge order alone must not decide. FTS rank only breaks ties.
	const tokens = q
		.split(/\s+/)
		.map((t) => t.replace(/^\*+|\*+$|\s+/g, '').replace(/"/g, '""'))
		.filter(Boolean);
	if (!tokens.length) return [];
	const exact = tokens.map((t) => `"${t}"`).join(' ');
	const prefixed = tokens.map((t) => `"${t}"*`).join(' ');

	type Row = { path: string; title: string; rank: number; snip: string | null };
	const sel = `SELECT path, title, rank, snippet(note_fts, 2, '\u258D', '\u258D', ' \u2026 ', 28) AS snip
		 FROM note_fts WHERE note_fts MATCH ? ORDER BY rank LIMIT 30`;
	const rows = db.prepare(sel).all(exact) as Row[];
	const extra = db.prepare(sel).all(prefixed) as Row[];

	const seen = new Set(rows.map((r) => r.path));
	for (const r of extra) {
		if (seen.has(r.path)) continue;
		rows.push(r);
		seen.add(r.path);
	}
	const query = q.trim().toLowerCase();
	const toks = tokens.map((t) => t.toLowerCase());
	return rows
		.map((r) => ({ ...r, score: titleScore(r.title, r.path, query, toks) }))
		.sort((a, b) => a.score - b.score || a.rank - b.rank)
		.slice(0, 30)
		.map((r) => ({
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
