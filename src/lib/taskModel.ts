// Task vocabulary shared by the server (validation, SQL) and the client
// (board columns, filters, labels). One list per concept so a new status or
// area is a one-line change.

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

// Areas group tasks by part of life. Fixed on purpose: four buckets cover a
// student's week, and a fixed set keeps colors and filters predictable.
export const AREAS = [
	{ key: 'college', label: 'College', color: '#8fb3ff' },
	{ key: 'learning', label: 'Learning', color: '#c4a8ff' },
	{ key: 'work', label: 'Work', color: '#f0a35e' },
	{ key: 'life', label: 'Life', color: '#d6c3a1' }
] as const;

export type TaskArea = (typeof AREAS)[number]['key'];

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

export function isArea(v: unknown): v is TaskArea {
	return AREAS.some((a) => a.key === v);
}

export function isPriority(v: unknown): v is TaskPriority {
	return PRIORITIES.some((p) => p.key === v);
}

export function statusMeta(key: TaskStatus) {
	return STATUSES.find((s) => s.key === key)!;
}

export function areaMeta(key: TaskArea) {
	return AREAS.find((a) => a.key === key)!;
}

// A project is a vault folder registered as one; tasks point at it by path.
// Its Inbox is the project backlog and stays on the project board. The
// main board and list only show a project task once it is planned.
export function onMainBoard(t: { project: string | null; status: TaskStatus }): boolean {
	return t.project == null || t.status !== 'inbox';
}

export function projectName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
