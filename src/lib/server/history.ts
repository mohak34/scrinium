import type { Database } from 'better-sqlite3';

// Per-note version history: a snapshot of a note's text after each write,
// with who wrote it (a user's email, an agent token's label, an OAuth
// app's name; null for a change the app never saw, like an edit on disk).
// Built on a db handle so it runs without the app (history.test.ts);
// db.ts holds the app's instance. A cache of past text, not of the vault:
// the note file stays the source of truth.

// Writes by the same author within a bucket fold into one version, so an
// agent appending 20 times or a minute of autosaves leaves one entry, and
// long sessions still checkpoint every bucket.
export const COALESCE_MS = 5 * 60_000;
// Versions kept per note; older ones are dropped on write.
export const KEEP_VERSIONS = 50;

export interface VersionRow {
	id: number;
	author: string | null;
	created_at: number;
	at: number;
	size: number;
}

export function noteHistory(db: Database) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS note_versions (
			id INTEGER PRIMARY KEY,
			path TEXT NOT NULL,
			content TEXT NOT NULL,
			author TEXT,
			created_at INTEGER NOT NULL,
			at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_note_versions_path ON note_versions(path, id);
	`);
	const latest = db.prepare(
		`SELECT id, content, author, created_at FROM note_versions WHERE path = ? ORDER BY id DESC LIMIT 1`
	);
	const insert = db.prepare(
		`INSERT INTO note_versions (path, content, author, created_at, at) VALUES (?, ?, ?, ?, ?)`
	);
	const fold = db.prepare(`UPDATE note_versions SET content = ?, at = ? WHERE id = ?`);
	const prune = db.prepare(
		`DELETE FROM note_versions WHERE path = ? AND id NOT IN
		 (SELECT id FROM note_versions WHERE path = ? ORDER BY id DESC LIMIT ?)`
	);
	// Same "path itself or inside folder path" range as db.ts's under().
	const under = `(path = ? OR (path >= ? AND path < ?))`;
	const underArgs = (path: string) => [path, `${path}/`, `${path}0`];

	// Books a write of `after` over `before` (null for a new note). Text the
	// history never saw (changed outside the app, or before history existed)
	// is kept first as an unattributed version, so every overwrite can be
	// undone. `coalesce: false` always starts a new version (a restore).
	const record = db.transaction(
		(path: string, before: string | null, after: string, author: string, now: number, coalesce = true) => {
			let last = latest.get(path) as
				| { id: number; content: string; author: string | null; created_at: number }
				| undefined;
			if (before !== null && last?.content !== before) {
				insert.run(path, before, null, now, now);
				last = undefined;
			}
			if (last?.content === after) return;
			if (coalesce && last && last.author === author && now - last.created_at < COALESCE_MS) {
				fold.run(after, now, last.id);
			} else {
				insert.run(path, after, author, now, now);
			}
			prune.run(path, path, KEEP_VERSIONS);
		}
	);

	return {
		record,
		// Newest first, without the text.
		list: (path: string) =>
			db
				.prepare(
					`SELECT id, author, created_at, at, length(content) AS size FROM note_versions
					 WHERE path = ? ORDER BY id DESC`
				)
				.all(path) as VersionRow[],
		content: (path: string, id: number) =>
			(
				db.prepare(`SELECT content FROM note_versions WHERE path = ? AND id = ?`).get(path, id) as
					| { content: string }
					| undefined
			)?.content ?? null,
		// History follows its note through renames and the bins, like task links.
		rename: db.transaction((from: string, to: string) => {
			db.prepare(`DELETE FROM note_versions WHERE ${under}`).run(...underArgs(to));
			db.prepare(`UPDATE note_versions SET path = ? || substr(path, ?) WHERE ${under}`).run(
				to,
				from.length + 1,
				...underArgs(from)
			);
		}),
		drop: (path: string) => db.prepare(`DELETE FROM note_versions WHERE ${under}`).run(...underArgs(path))
	};
}
