import { writable, get } from 'svelte/store';

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Task {
	id: string;
	title: string;
	detail: string;
	status: TaskStatus;
	due_at: number | null;
	remind_min: number | null;
	note_path: string | null;
	position: number;
	created_at: number;
	updated_at: number;
	gcal_event_id: string | null;
}

export interface NewTaskInput {
	title: string;
	detail?: string;
	status?: TaskStatus;
	due_at?: number | null;
	remind_min?: number | null;
	note_path?: string | null;
}

export type TaskUpdate = Partial<
	Pick<Task, 'title' | 'detail' | 'status' | 'due_at' | 'remind_min' | 'note_path' | 'position'>
>;

export const tasks = writable<Task[]>([]);
export const tasksLoading = writable(false);

export async function loadTasks(): Promise<Task[]> {
	tasksLoading.set(true);
	try {
		const res = await fetch('/api/tasks', { credentials: 'include' });
		if (!res.ok) return get(tasks);
		const rows = (await res.json()) as Task[];
		tasks.set(rows);
		return rows;
	} finally {
		tasksLoading.set(false);
	}
}

export async function createTask(input: NewTaskInput): Promise<Task | null> {
	const res = await fetch('/api/tasks', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) return null;
	const row = (await res.json()) as Task;
	tasks.update((all) => [...all, row]);
	return row;
}

export async function updateTask(id: string, patch: TaskUpdate): Promise<Task | null> {
	// Optimistic: paint first, roll back on failure.
	const before = get(tasks);
	tasks.update((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
	if (!res.ok) {
		tasks.set(before);
		return null;
	}
	const row = (await res.json()) as Task;
	tasks.update((all) => all.map((t) => (t.id === id ? row : t)));
	return row;
}

export async function deleteTask(id: string): Promise<boolean> {
	const before = get(tasks);
	tasks.update((all) => all.filter((t) => t.id !== id));
	const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		credentials: 'include'
	});
	if (!res.ok) {
		tasks.set(before);
		return false;
	}
	return true;
}

// --- Due-date helpers (local midnight boundaries) ---

export function startOfToday(): number {
	const n = new Date();
	return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

export function isOverdue(t: Task): boolean {
	if (t.status === 'done' || t.due_at == null) return false;
	return t.due_at < startOfToday();
}

export function isDueToday(t: Task): boolean {
	if (t.due_at == null) return false;
	const day = 24 * 60 * 60 * 1000;
	return t.due_at >= startOfToday() && t.due_at < startOfToday() + day;
}

export function dueLabel(dueAt: number | null): string {
	if (dueAt == null) return 'No date';
	try {
		return new Date(dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
	} catch {
		return 'No date';
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
