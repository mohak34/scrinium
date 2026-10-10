import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import { titleScore } from './rank';
import type { TaskStatus, TaskPriority, TaskArea } from '../taskModel';

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

// SQL for "`col` is `path` itself or anything inside the folder `path`",
// bound with underArgs(path). A binary range, not LIKE: LIKE ignores case
// and treats _ and % as wildcards, so renaming "cs_589" would also drag
// "csX589/..." along. '0' is the character after '/'.
export const under = (col: string) => `(${col} = ? OR (${col} >= ? AND ${col} < ?))`;
export const underArgs = (path: string) => [path, `${path}/`, `${path}0`];

export function upsertNoteMeta(relPath: string, title: string, updatedAt: number) {
	db.prepare(
		`INSERT INTO note_meta (path, title, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
	).run(relPath, title, updatedAt);
}

export function deleteNoteMetaByPrefix(relPath: string) {
	db.prepare(`DELETE FROM note_meta WHERE ${under('path')}`).run(...underArgs(relPath));
}

export function renameNoteMeta(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT path FROM note_meta WHERE ${under('path')}`)
		.all(...underArgs(oldPath)) as { path: string }[];
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
	db.prepare(`DELETE FROM note_fts WHERE ${under('path')}`).run(...underArgs(relPath));
}

export function renameNoteIndex(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT path, title, body FROM note_fts WHERE ${under('path')}`)
		.all(...underArgs(oldPath)) as { path: string; title: string; body: string }[];
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

// Long-lived API tokens for the mobile client and agents (MCP). Only the
// SHA-256 hash is stored - the raw token is returned once at issue time and
// never persisted anywhere the server can read back. label names the holder
// ("Muse"); phone tokens from /api/auth/mobile have none.
db.exec(`
	CREATE TABLE IF NOT EXISTS api_tokens (
		token_hash TEXT PRIMARY KEY,
		user_email TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER,
		label TEXT
	);
`);
{
	const cols = db.prepare(`PRAGMA table_info(api_tokens)`).all() as { name: string }[];
	if (!cols.some((c) => c.name === 'label')) db.exec(`ALTER TABLE api_tokens ADD COLUMN label TEXT`);
}

export interface ApiTokenRow {
	token_hash: string;
	user_email: string;
	created_at: number;
	last_used_at: number | null;
	label: string | null;
}

export function insertApiToken(tokenHash: string, userEmail: string, label: string | null = null) {
	db.prepare(
		`INSERT INTO api_tokens (token_hash, user_email, created_at, label) VALUES (?, ?, ?, ?)`
	).run(tokenHash, userEmail.toLowerCase(), Date.now(), label);
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
	db.prepare(`DELETE FROM agent_actions WHERE token_hash = ?`).run(tokenHash);
}

// What each agent token changed through MCP, newest first, for Settings >
// Agents. A trust log, not an audit trail: rows older than 30
// days are pruned on insert and revoking a token drops its rows.
db.exec(`
	CREATE TABLE IF NOT EXISTS agent_actions (
		id INTEGER PRIMARY KEY,
		token_hash TEXT NOT NULL,
		tool TEXT NOT NULL,
		target TEXT NOT NULL,
		at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_agent_actions_token ON agent_actions(token_hash, at);
`);

export interface AgentAction {
	tool: string;
	target: string;
	at: number;
}

export function logAgentAction(tokenHash: string, tool: string, target: string) {
	const now = Date.now();
	db.prepare(`DELETE FROM agent_actions WHERE at < ?`).run(now - 30 * 86400000);
	db.prepare(`INSERT INTO agent_actions (token_hash, tool, target, at) VALUES (?, ?, ?, ?)`).run(
		tokenHash,
		tool,
		target.slice(0, 300),
		now
	);
}

export function listAgentActions(tokenHash: string, limit = 50): AgentAction[] {
	return db
		.prepare(`SELECT tool, target, at FROM agent_actions WHERE token_hash = ? ORDER BY at DESC, id DESC LIMIT ?`)
		.all(tokenHash, limit) as AgentAction[];
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

// Standalone tasks section (separate from note checklists). Due dates are
// first-class columns, not parsed from text. gcal_event_id is a placeholder
// for the later Calendar sync phase - no sync logic reads it yet.
// status, area and priority come from $lib/taskModel. waiting_on names who a
// 'waiting' task is blocked on; waiting_since stamps when it entered that
// column (set and cleared by updateTask). parent_id nests a task as a
// subtask of another (one level in the UI; deeper nesting is stored but the
// drawer only renders direct children). remind_at is an absolute timestamp,
// independent of due_at, so reminders survive due-date moves. Vault
// references live in task_links (many notes per task), not on the row.
db.exec(`
	CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		detail TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'todo',
		priority TEXT NOT NULL DEFAULT 'none',
		parent_id TEXT,
		due_at INTEGER,
		remind_at INTEGER,
		notified_at INTEGER,
		position REAL NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		gcal_event_id TEXT
	);
`);

db.exec(`
	CREATE TABLE IF NOT EXISTS task_links (
		task_id TEXT NOT NULL,
		note_path TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (task_id, note_path)
	);
`);

// Migrate older DBs forward. Each step is guarded so restarts are no-ops.
{
	const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
	const names = new Set(cols.map((c) => c.name));
	if (!names.has('priority')) db.exec(`ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'`);
	if (!names.has('parent_id')) db.exec(`ALTER TABLE tasks ADD COLUMN parent_id TEXT`);
	if (!names.has('notified_at')) db.exec(`ALTER TABLE tasks ADD COLUMN notified_at INTEGER`);
	if (!names.has('remind_at')) {
		db.exec(`ALTER TABLE tasks ADD COLUMN remind_at INTEGER`);
		// remind_min (minutes before due) becomes an absolute timestamp.
		if (names.has('remind_min')) {
			db.exec(
				`UPDATE tasks SET remind_at = due_at - remind_min * 60000
				 WHERE remind_min IS NOT NULL AND due_at IS NOT NULL`
			);
		}
	}
	if (!names.has('area')) db.exec(`ALTER TABLE tasks ADD COLUMN area TEXT`);
	if (!names.has('waiting_on')) db.exec(`ALTER TABLE tasks ADD COLUMN waiting_on TEXT`);
	if (!names.has('waiting_since')) db.exec(`ALTER TABLE tasks ADD COLUMN waiting_since INTEGER`);
	if (!names.has('project')) db.exec(`ALTER TABLE tasks ADD COLUMN project TEXT`);
	if (names.has('note_path')) {
		// Old single-note column folds into the links table, then goes away.
		db.prepare(
			`INSERT OR IGNORE INTO task_links (task_id, note_path, created_at)
			 SELECT id, note_path, created_at FROM tasks WHERE note_path IS NOT NULL AND note_path != ''`
		).run();
	}
	// Single source of truth from here on: links live in task_links.
	if (names.has('remind_min')) db.exec(`ALTER TABLE tasks DROP COLUMN remind_min`);
	if (names.has('note_path')) db.exec(`ALTER TABLE tasks DROP COLUMN note_path`);
}

export type { TaskStatus, TaskPriority, TaskArea };

export interface TaskRow {
	id: string;
	title: string;
	detail: string;
	status: TaskStatus;
	priority: TaskPriority;
	area: TaskArea | null;
	waiting_on: string | null;
	waiting_since: number | null;
	parent_id: string | null;
	project: string | null;
	due_at: number | null;
	remind_at: number | null;
	notified_at: number | null;
	link_count: number;
	position: number;
	created_at: number;
	updated_at: number;
	gcal_event_id: string | null;
}

const TASK_COLS = `tasks.*, (SELECT COUNT(*) FROM task_links WHERE task_id = tasks.id) AS link_count`;

export function listTasks(): TaskRow[] {
	return db
		.prepare(`SELECT ${TASK_COLS} FROM tasks ORDER BY position ASC, created_at ASC`)
		.all() as TaskRow[];
}

export function getTask(id: string): TaskRow | undefined {
	return db.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).get(id) as
		| TaskRow
		| undefined;
}

export interface NewTask {
	id: string;
	title: string;
	detail?: string;
	status?: TaskStatus;
	priority?: TaskPriority;
	area?: TaskArea | null;
	waiting_on?: string | null;
	parent_id?: string | null;
	project?: string | null;
	due_at?: number | null;
	remind_at?: number | null;
	position?: number;
}

export function insertTask(t: NewTask): TaskRow {
	const now = Date.now();
	db.prepare(
		`INSERT INTO tasks (id, title, detail, status, priority, area, waiting_on, waiting_since,
		 parent_id, project, due_at, remind_at, position, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		t.id,
		t.title,
		t.detail ?? '',
		t.status ?? 'todo',
		t.priority ?? 'none',
		t.area ?? null,
		t.waiting_on ?? null,
		t.status === 'waiting' ? now : null,
		t.parent_id ?? null,
		t.project ?? null,
		t.due_at ?? null,
		t.remind_at ?? null,
		t.position ?? now,
		now,
		now
	);
	return getTask(t.id)!;
}

export type TaskPatch = Partial<
	Pick<
		TaskRow,
		| 'title'
		| 'detail'
		| 'status'
		| 'priority'
		| 'area'
		| 'waiting_on'
		| 'parent_id'
		| 'project'
		| 'due_at'
		| 'remind_at'
		| 'position'
		| 'gcal_event_id'
	>
>;

export function updateTask(id: string, patch: TaskPatch): TaskRow | undefined {
	const cur = getTask(id);
	if (!cur) return undefined;
	const next = { ...cur, ...patch, updated_at: Date.now() };
	// A changed (or cleared) reminder re-arms: a new time must fire again.
	if ('remind_at' in patch && patch.remind_at !== cur.remind_at) next.notified_at = null;
	// Entering Waiting starts its clock; leaving it clears the clock.
	if (next.status !== cur.status) {
		next.waiting_since = next.status === 'waiting' ? next.updated_at : null;
	}
	db.prepare(
		`UPDATE tasks SET title = ?, detail = ?, status = ?, priority = ?, area = ?,
		 waiting_on = ?, waiting_since = ?, parent_id = ?, project = ?,
		 due_at = ?, remind_at = ?, notified_at = ?,
		 position = ?, updated_at = ?, gcal_event_id = ? WHERE id = ?`
	).run(
		next.title,
		next.detail,
		next.status,
		next.priority,
		next.area,
		next.waiting_on,
		next.waiting_since,
		next.parent_id,
		next.project,
		next.due_at,
		next.remind_at,
		next.notified_at,
		next.position,
		next.updated_at,
		next.gcal_event_id,
		id
	);
	return getTask(id);
}

// Subtasks carry their root's project; a change on the root follows down.
export function setSubtreeProject(id: string, project: string | null) {
	const kidsOf = db.prepare(`SELECT id FROM tasks WHERE parent_id = ?`);
	const set = db.prepare(`UPDATE tasks SET project = ? WHERE id = ?`);
	const seen = new Set<string>([id]);
	db.transaction(() => {
		for (const cur of seen) {
			for (const k of kidsOf.all(cur) as { id: string }[]) {
				if (seen.has(k.id)) continue;
				seen.add(k.id);
				set.run(project, k.id);
			}
		}
	})();
}

export function deleteTask(id: string) {
	// Subtasks belong to their parent - remove the whole subtree, links with
	// it. Iterative with a seen set, so even a cyclic parent chain ends.
	const doomed = new Set<string>([id]);
	const kidsOf = db.prepare(`SELECT id FROM tasks WHERE parent_id = ?`);
	for (const cur of doomed) {
		for (const k of kidsOf.all(cur) as { id: string }[]) doomed.add(k.id);
	}
	const dropLinks = db.prepare(`DELETE FROM task_links WHERE task_id = ?`);
	const dropTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);
	db.transaction(() => {
		for (const t of doomed) {
			dropLinks.run(t);
			dropTask.run(t);
		}
	})();
}

// Tasks that reference a note, for the note's right panel.
export function listTasksForNote(notePath: string): TaskRow[] {
	return db
		.prepare(
			`SELECT ${TASK_COLS} FROM tasks
			 WHERE id IN (SELECT task_id FROM task_links WHERE note_path = ?)
			 ORDER BY (status = 'done'), due_at IS NULL, due_at ASC, position ASC`
		)
		.all(notePath) as TaskRow[];
}

// Keep links pointing at the file after a note or folder rename, same as shares.
export function renameTaskLinks(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT DISTINCT note_path FROM task_links WHERE ${under('note_path')}`)
		.all(...underArgs(oldPath)) as { note_path: string }[];
	const move = db.prepare(`UPDATE OR IGNORE task_links SET note_path = ? WHERE note_path = ?`);
	// Rows left behind were already linked at the new path; drop the duplicates.
	const drop = db.prepare(`DELETE FROM task_links WHERE note_path = ?`);
	db.transaction(() => {
		for (const { note_path } of rows) {
			move.run(newPath + note_path.slice(oldPath.length), note_path);
			drop.run(note_path);
		}
	})();
}

export function listTaskLinks(taskId: string): string[] {
	const rows = db
		.prepare(`SELECT note_path FROM task_links WHERE task_id = ? ORDER BY created_at ASC`)
		.all(taskId) as { note_path: string }[];
	return rows.map((r) => r.note_path);
}

export function addTaskLink(taskId: string, notePath: string): string[] {
	db.prepare(
		`INSERT OR IGNORE INTO task_links (task_id, note_path, created_at) VALUES (?, ?, ?)`
	).run(taskId, notePath, Date.now());
	return listTaskLinks(taskId);
}

export function removeTaskLink(taskId: string, notePath: string): string[] {
	db.prepare(`DELETE FROM task_links WHERE task_id = ? AND note_path = ?`).run(taskId, notePath);
	return listTaskLinks(taskId);
}

// Projects: vault folders registered as a project board. The folder holds
// the project's notes; tasks.project holds the folder path. area is the
// default for tasks created on the board. Rows outlive a trashed folder, so
// restoring it brings the project back as it was.
db.exec(`
	CREATE TABLE IF NOT EXISTS projects (
		path TEXT PRIMARY KEY,
		area TEXT,
		created_at INTEGER NOT NULL
	);
`);

export interface ProjectRow {
	path: string;
	area: TaskArea | null;
	created_at: number;
}

export function listProjects(): ProjectRow[] {
	return db.prepare(`SELECT * FROM projects ORDER BY path COLLATE NOCASE`).all() as ProjectRow[];
}

export function getProject(path: string): ProjectRow | undefined {
	return db.prepare(`SELECT * FROM projects WHERE path = ?`).get(path) as ProjectRow | undefined;
}

// Undefined when the path is already a project.
export function insertProject(path: string, area: TaskArea | null): ProjectRow | undefined {
	const { changes } = db
		.prepare(`INSERT OR IGNORE INTO projects (path, area, created_at) VALUES (?, ?, ?)`)
		.run(path, area, Date.now());
	return changes ? getProject(path) : undefined;
}

export function setProjectArea(path: string, area: TaskArea | null): ProjectRow | undefined {
	db.prepare(`UPDATE projects SET area = ? WHERE path = ?`).run(area, path);
	return getProject(path);
}

// Unregistering a project leaves its folder alone; its tasks fall back to
// the main board.
export function deleteProject(path: string) {
	db.transaction(() => {
		db.prepare(`UPDATE tasks SET project = NULL WHERE project = ?`).run(path);
		db.prepare(`DELETE FROM projects WHERE path = ?`).run(path);
	})();
}

// Moves projects under oldPath to the same place under newPath, tasks with
// them. A stale row already at the target (its folder was trashed) merges in.
function moveProjects(oldPath: string, newPath: string, rows: { path: string }[]) {
	if (oldPath === newPath) return;
	const move = db.prepare(`UPDATE OR IGNORE projects SET path = ? WHERE path = ?`);
	const drop = db.prepare(`DELETE FROM projects WHERE path = ?`);
	const retag = db.prepare(`UPDATE tasks SET project = ? WHERE project = ?`);
	db.transaction(() => {
		for (const { path } of rows) {
			const to = newPath + path.slice(oldPath.length);
			move.run(to, path);
			drop.run(path);
			retag.run(to, path);
		}
	})();
}

// A renamed or moved folder takes its projects (and nested ones) along.
export function renameProjects(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT path FROM projects WHERE ${under('path')}`)
		.all(...underArgs(oldPath)) as { path: string }[];
	moveProjects(oldPath, newPath, rows);
}

// A folder restored from the trash under a new name ("P (1)") takes back the
// projects whose folders came back with it (cameBack checks the new path).
// Projects registered after the trash belong to whatever now sits at the
// old path.
export function moveTrashedProjects(
	oldPath: string,
	newPath: string,
	deletedAt: number,
	cameBack: (path: string) => boolean
) {
	const rows = db
		.prepare(`SELECT path FROM projects WHERE ${under('path')} AND created_at <= ?`)
		.all(...underArgs(oldPath), deletedAt) as { path: string }[];
	moveProjects(
		oldPath,
		newPath,
		rows.filter((r) => cameBack(newPath + r.path.slice(oldPath.length)))
	);
}

// Reminders that are due and haven't fired. Done tasks never fire, and a
// fired reminder only re-arms when remind_at itself changes (see updateTask).
export function listDueReminders(now: number): TaskRow[] {
	return db
		.prepare(
			`SELECT ${TASK_COLS} FROM tasks
			 WHERE remind_at IS NOT NULL AND remind_at <= ? AND notified_at IS NULL AND status != 'done'
			 ORDER BY remind_at ASC`
		)
		.all(now) as TaskRow[];
}

export function markRemindersNotified(ids: string[], now: number) {
	if (ids.length === 0) return;
	const stmt = db.prepare(`UPDATE tasks SET notified_at = ? WHERE id = ? AND notified_at IS NULL`);
	for (const id of ids) stmt.run(now, id);
}
