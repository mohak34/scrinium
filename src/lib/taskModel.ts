import type { ProjectView } from './projects';

// Task vocabulary shared by the server (validation, SQL) and the client
// (board columns, filters, labels). One list per concept so a new status is
// a one-line change. Tasks group by project (a vault-root folder), and a task
// in no project is Quotidian; see $lib/projects.

// Board columns, left to right. 'todo' is the committed "This week" column;
// the key keeps its old name so existing rows and API clients still work.
export const STATUSES = [
	{ key: 'inbox', label: 'Inbox', icon: 'inbox', hint: 'Captured, not planned yet' },
	{ key: 'todo', label: 'This week', icon: 'date_range', hint: 'Committed for this week' },
	{ key: 'doing', label: 'Doing', icon: 'progress_activity', hint: 'Keep this short' },
	{ key: 'waiting', label: 'Waiting', icon: 'hourglass_top', hint: 'Blocked on someone else' },
	{ key: 'done', label: 'Done', icon: 'check_circle', hint: 'Finished' }
] as const;

export type TaskStatus = (typeof STATUSES)[number]['key'];

export const PRIORITIES = [
	{ key: 'none', label: 'No priority' },
	{ key: 'low', label: 'Low' },
	{ key: 'medium', label: 'Medium' },
	{ key: 'high', label: 'High' },
	{ key: 'urgent', label: 'Urgent' }
] as const;

export type TaskPriority = (typeof PRIORITIES)[number]['key'];

// Soft cap on the Doing column; the board warns past it, never blocks.
export const DOING_LIMIT = 3;

export function isStatus(v: unknown): v is TaskStatus {
	return STATUSES.some((s) => s.key === v);
}

export function isPriority(v: unknown): v is TaskPriority {
	return PRIORITIES.some((p) => p.key === v);
}

export function statusMeta(key: TaskStatus) {
	return STATUSES.find((s) => s.key === key)!;
}

// A project is a vault folder registered as one; tasks point at it by path.
// Its undated Inbox is the project backlog and stays on the project board:
// the All views (board, list, calendar, agenda) show a project task once it
// is planned or dated.
function onMainBoard(t: { project: string | null; status: TaskStatus; due_at: number | null }): boolean {
	return t.project == null || t.status !== 'inbox' || t.due_at != null;
}

type Selectable = { id: string; parent_id: string | null; project: string | null; status: TaskStatus; due_at: number | null };

/**
 * The tasks a view shows, subtasks included (callers keep `topLevel` ones
 * where they list only roots). One project, or Quotidian with `project:
 * null`, is every task in it. All is every task on the main board: dated
 * ones, plus the rest unless they or an ancestor sit in a project backlog.
 * The board, list, calendar and MCP agenda all select through here.
 */
export function selectTasks<T extends Selectable>(all: readonly T[], view: ProjectView): T[] {
	if (view !== 'all') return all.filter((t) => t.project === view.project);
	const byId = new Map(all.map((t) => [t.id, t]));
	const planned = (t: T) => {
		const seen = new Set<string>();
		for (let a: T | undefined = t; a && !seen.has(a.id); a = byId.get(a.parent_id ?? '')) {
			if (!onMainBoard(a)) return false;
			seen.add(a.id);
		}
		return true;
	};
	return all.filter((t) => t.due_at != null || planned(t));
}

export function projectName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
