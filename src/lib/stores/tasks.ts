import { writable, get } from 'svelte/store';
import type { TaskPriority, TaskStatus } from '$lib/taskModel';
import type { ProjectColor, ProjectIcon } from '$lib/projects';

export type { TaskPriority, TaskStatus };
export { PRIORITIES, STATUSES } from '$lib/taskModel';

export interface Task {
	id: string;
	title: string;
	detail: string;
	status: TaskStatus;
	priority: TaskPriority;
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

export interface NewTaskInput {
	title: string;
	detail?: string;
	status?: TaskStatus;
	priority?: TaskPriority;
	waiting_on?: string | null;
	parent_id?: string | null;
	project?: string | null;
	due_at?: number | null;
	remind_at?: number | null;
}

export type TaskUpdate = Partial<
	Pick<
		Task,
		| 'title'
		| 'detail'
		| 'status'
		| 'priority'
		| 'waiting_on'
		| 'parent_id'
		| 'project'
		| 'due_at'
		| 'remind_at'
		| 'position'
	>
>;

export const tasks = writable<Task[]>([]);
export const tasksLoading = writable(false);

// Id of the task open in the detail drawer, null when closed. Lives here so
// agenda, kanban and the layout-level drawer share one source of truth.
export const openTaskId = writable<string | null>(null);

export function openTask(id: string) {
	openTaskId.set(id);
}

export function closeTask() {
	openTaskId.set(null);
}

/** Top-level tasks only - subtasks live inside the drawer. */
export function topLevel(all: Task[]): Task[] {
	return all.filter((t) => t.parent_id == null);
}

export function childrenOf(all: Task[], id: string): Task[] {
	return all
		.filter((t) => t.parent_id === id)
		.sort((a, b) => a.position - b.position || a.created_at - b.created_at);
}

// Writes that change the task list (tasks, project removal, links) in
// flight, and a count bumped as each starts and lands. A
// list fetch that overlapped a write may predate it, so it is dropped
// rather than painted over the write, and fetched again once writes settle.
let writing = 0;
let writes = 0;
let reloadWanted = false;

function taskWrite(req: () => Promise<Response>): Promise<Response> {
	writing++;
	writes++;
	return req().finally(() => {
		writing--;
		writes++;
		if (writing === 0 && reloadWanted) {
			reloadWanted = false;
			void loadTasks();
		}
	});
}

// Loads in flight; only the newest one paints. tasksLoading stays true
// across a dropped load's retry, whether it starts at once or waits for
// writes to settle.
let loads = 0;
let latestTaskLoad = 0;

export async function loadTasks(): Promise<Task[]> {
	loads++;
	const me = ++latestTaskLoad;
	tasksLoading.set(true);
	try {
		const n = writes;
		const res = await fetch('/api/tasks', { credentials: 'include' });
		if (!res.ok) return get(tasks);
		const rows = (await res.json()) as Task[];
		if (me !== latestTaskLoad) return get(tasks);
		if (writes !== n || writing > 0) {
			if (writing === 0) return loadTasks();
			reloadWanted = true;
			return get(tasks);
		}
		tasks.set(rows);
		return rows;
	} finally {
		loads--;
		tasksLoading.set(loads > 0 || reloadWanted);
	}
}

export async function createTask(input: NewTaskInput): Promise<Task | null> {
	const res = await taskWrite(() =>
		fetch('/api/tasks', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		})
	);
	if (!res.ok) return null;
	const row = (await res.json()) as Task;
	tasks.update((all) => [...all.filter((t) => t.id !== row.id), row]);
	return row;
}

// Writes to one task run one at a time, in the order they were made, like
// note autosave: two quick edits (doing, then done) can never reach the
// server swapped. Each queued write resolves to null on a network error.
const taskQueue = new Map<string, Promise<unknown>>();

function queued(id: string, req: () => Promise<Response>): Promise<Response | null> {
	const run = (taskQueue.get(id) ?? Promise.resolve()).then(() => taskWrite(req).catch(() => null));
	taskQueue.set(id, run);
	void run.then(() => {
		if (taskQueue.get(id) === run) taskQueue.delete(id);
	});
	return run;
}

// Latest edit number per task. Only the newest edit's answer paints, so the
// screen keeps every edit still waiting in the queue.
const editSeq = new Map<string, number>();

export async function updateTask(id: string, patch: TaskUpdate): Promise<Task | null> {
	const n = (editSeq.get(id) ?? 0) + 1;
	editSeq.set(id, n);
	tasks.update((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	const res = await queued(id, () =>
		fetch(`/api/tasks/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		})
	);
	const row = res?.ok ? ((await res.json()) as Task) : null;
	if (editSeq.get(id) !== n) return row;
	// A failed edit shows what the server kept, not a guess at it. A new
	// project or parent moves the whole subtree on the server, so reload.
	if (!row || 'project' in patch || 'parent_id' in patch) void loadTasks();
	else tasks.update((all) => all.map((t) => (t.id === id ? row : t)));
	return row;
}

export async function deleteTask(id: string): Promise<boolean> {
	const before = get(tasks);
	// Optimistic: drop the whole subtree so drawer subtasks vanish at once.
	const doomed = new Set<string>([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const t of get(tasks)) {
			if (t.parent_id && doomed.has(t.parent_id) && !doomed.has(t.id)) {
				doomed.add(t.id);
				grew = true;
			}
		}
	}
	tasks.update((all) => all.filter((t) => !doomed.has(t.id)));
	if (doomed.has(get(openTaskId) ?? '')) closeTask();
	const res = await queued(id, () =>
		fetch(`/api/tasks/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			credentials: 'include'
		})
	);
	if (!res?.ok) {
		// Put back only the subtree, not the whole list as it was.
		tasks.update((all) => [
			...all.filter((t) => !doomed.has(t.id)),
			...before.filter((t) => doomed.has(t.id))
		]);
		return false;
	}
	return true;
}

// --- Projects (see selectTasks in $lib/taskModel) ---

export interface Project {
	path: string;
	created_at: number;
	icon: string | null;
	color: string | null;
}

export const projects = writable<Project[]>([]);

// The New project dialog, mounted by the root layout while true.
export const newProjectOpen = writable(false);

// Only the newest load lands; an older one resolves with the newest one's
// result, so every caller sees the list the store ends up with (null if
// that load failed). Every project change here starts a fresh load once it
// succeeds, so a list fetched before the change can't undo it.
let projectsLoad = 0;
let latestLoad: Promise<Project[] | null> = Promise.resolve(null);

export function loadProjects(): Promise<Project[] | null> {
	const n = ++projectsLoad;
	latestLoad = (async () => {
		const res = await fetch('/api/projects', { credentials: 'include' }).catch(() => null);
		const rows = res?.ok ? ((await res.json().catch(() => null)) as Project[] | null) : null;
		if (n !== projectsLoad) return latestLoad;
		if (rows) projects.set(rows);
		return rows;
	})();
	return latestLoad;
}

const sendProject = (method: string, body: unknown) =>
	fetch('/api/projects', {
		method,
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	}).catch(() => null);

/** Registers a folder (created when missing). Resolves to an error message on failure. */
export async function createProject(path: string): Promise<Project | string> {
	const res = await sendProject('POST', { path });
	if (!res?.ok) return (await res?.json().catch(() => null))?.message ?? 'Could not create the project';
	const row = (await res.json()) as Project;
	void loadProjects();
	projects.update((all) =>
		[...all.filter((p) => p.path !== row.path), row].sort((a, b) => a.path.localeCompare(b.path))
	);
	return row;
}

/** Sets the sidebar icon or color, shown at once; the reload puts it back if the write failed. */
export async function styleProject(path: string, style: { icon?: ProjectIcon; color?: ProjectColor }) {
	projects.update((all) => all.map((p) => (p.path === path ? { ...p, ...style } : p)));
	await fetch(`/api/projects?path=${encodeURIComponent(path)}`, {
		method: 'PATCH',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(style)
	}).catch(() => null);
	void loadProjects();
}

/** Unregisters the project; the folder stays and its tasks join Quotidian. */
export async function removeProject(path: string): Promise<boolean> {
	const res = await taskWrite(() =>
		fetch(`/api/projects?path=${encodeURIComponent(path)}`, {
			method: 'DELETE',
			credentials: 'include'
		})
	).catch(() => null);
	if (!res?.ok) return false;
	void loadProjects();
	projects.update((all) => all.filter((p) => p.path !== path));
	tasks.update((all) => all.map((t) => (t.project === path ? { ...t, project: null } : t)));
	return true;
}

// --- Due-date helpers (local midnight boundaries) ---

export function startOfToday(): number {
	const n = new Date();
	return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

// Next local midnight. Not startOfToday() + 24 h: DST days are 23 or 25
// hours long.
export function startOfTomorrow(): number {
	const n = new Date();
	return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime();
}

export function isOverdue(t: Task): boolean {
	if (t.status === 'done' || t.due_at == null) return false;
	return t.due_at < startOfToday();
}

export function isDueToday(t: Task): boolean {
	if (t.due_at == null) return false;
	return t.due_at >= startOfToday() && t.due_at < startOfTomorrow();
}

export function dueLabel(dueAt: number | null): string {
	if (dueAt == null) return 'No date';
	try {
		const d = new Date(dueAt);
		const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
		if (d.getHours() === 0 && d.getMinutes() === 0) return date;
		return `${date}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
	} catch {
		return 'No date';
	}
}

/** Short stamp for absolute times (reminders): 'Sep 26, 9:00 AM'. */
export function stampShort(ts: number | null): string {
	if (ts == null) return 'No reminder';
	try {
		return new Date(ts).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	} catch {
		return 'No reminder';
	}
}

/** date-input value (YYYY-MM-DD) for a due timestamp, '' when unset. */
export function dueInputValue(dueAt: number | null): string {
	if (dueAt == null) return '';
	const d = new Date(dueAt);
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

/** Parse a date-input value to a local-midnight timestamp, null when cleared. */
export function parseDueInput(v: string): number | null {
	if (!v) return null;
	const d = new Date(`${v}T00:00:00`);
	return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Time-input value (HH:MM) for a due timestamp, '' when unset or midnight. */
export function dueTimeValue(dueAt: number | null): string {
	if (dueAt == null) return '';
	const d = new Date(dueAt);
	if (d.getHours() === 0 && d.getMinutes() === 0) return '';
	const h = String(d.getHours()).padStart(2, '0');
	const m = String(d.getMinutes()).padStart(2, '0');
	return `${h}:${m}`;
}

/** Combine date + optional time inputs to a local timestamp. */
export function combineDateTime(dateStr: string, timeStr: string): number | null {
	if (!dateStr) return null;
	const d = new Date(`${dateStr}T${timeStr || '00:00'}:00`);
	return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** datetime-local input value (YYYY-MM-DDTHH:MM) for a timestamp. */
export function dateTimeInputValue(ts: number | null): string {
	if (ts == null) return '';
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Parse a datetime-local input value to a timestamp, null when cleared. */
export function parseDateTimeInput(v: string): number | null {
	if (!v) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// --- Linked notes (many per task) ---

export async function loadTaskLinks(id: string): Promise<string[]> {
	const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/links`, { credentials: 'include' });
	if (!res.ok) return [];
	return res.json();
}

export async function addTaskLink(id: string, notePath: string): Promise<string[]> {
	const res = await taskWrite(() =>
		fetch(`/api/tasks/${encodeURIComponent(id)}/links`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ note_path: notePath })
		})
	);
	if (!res.ok) return loadTaskLinks(id);
	const rows = (await res.json()) as string[];
	syncLinkCount(id, rows.length);
	return rows;
}

export async function removeTaskLink(id: string, notePath: string): Promise<string[]> {
	const res = await taskWrite(() =>
		fetch(`/api/tasks/${encodeURIComponent(id)}/links?note_path=${encodeURIComponent(notePath)}`, {
			method: 'DELETE',
			credentials: 'include'
		})
	);
	if (!res.ok) return loadTaskLinks(id);
	const rows = (await res.json()) as string[];
	syncLinkCount(id, rows.length);
	return rows;
}

function syncLinkCount(id: string, count: number) {
	tasks.update((all) => all.map((t) => (t.id === id ? { ...t, link_count: count } : t)));
}
