import type { Database } from "better-sqlite3";

// Moves (PATCH /api/notes) a client tagged with an operation id, so a retry
// after a lost reply answers "done" instead of moving again or failing on
// the missing source. Built on a db handle so it runs without the app
// (moves.test.ts); db.ts holds the app's instance.

// Ids are kept this long; a client retries within minutes, not months.
export const KEEP_MS = 30 * 24 * 60 * 60_000;

export function noteMoves(db: Database) {
  db.exec(`
		CREATE TABLE IF NOT EXISTS note_moves (
			op_id TEXT PRIMARY KEY,
			from_path TEXT NOT NULL,
			to_path TEXT NOT NULL,
			at INTEGER NOT NULL
		);
	`);
  const get = db.prepare(`SELECT 1 FROM note_moves WHERE op_id = ?`);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO note_moves (op_id, from_path, to_path, at) VALUES (?, ?, ?, ?)`,
  );
  const prune = db.prepare(`DELETE FROM note_moves WHERE at < ?`);
  return {
    done: (opId: string) => get.get(opId) !== undefined,
    record(opId: string, from: string, to: string, now = Date.now()) {
      prune.run(now - KEEP_MS);
      insert.run(opId, from, to, now);
    },
  };
}
