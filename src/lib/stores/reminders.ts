import { writable, get } from 'svelte/store';
import { updateTask, type Task } from './tasks';

// Reminders that fired and wait on the user, oldest first. They stay until
// done, snoozed or cleared, so closing the panel loses nothing: the bell in
// the bottom bar reopens it.
export const reminders = writable<Task[]>([]);
export const remindersOpen = writable(false);

async function call(method: 'GET' | 'POST'): Promise<Task[] | null> {
	try {
		const res = await fetch('/api/tasks/due', { method, credentials: 'include' });
		return res.ok ? ((await res.json()) as Task[]) : null;
	} catch {
		return null;
	}
}

// Fires what just came due (the panel opens for it), then reloads the list,
// which also drops reminders handled in another tab or on the phone.
export async function pollReminders() {
	const fresh = await call('POST');
	const all = await call('GET');
	if (all) reminders.set(all);
	if (fresh?.length) remindersOpen.set(true);
}

function drop(id: string) {
	reminders.update((all) => all.filter((t) => t.id !== id));
	if (get(reminders).length === 0) remindersOpen.set(false);
}

export function completeReminder(id: string) {
	drop(id);
	void updateTask(id, { status: 'done' });
}

// A new remind_at re-arms the reminder on the server.
export function snoozeReminder(id: string, until: number) {
	drop(id);
	void updateTask(id, { remind_at: until });
}

export function clearReminder(id: string) {
	drop(id);
	void updateTask(id, { remind_at: null });
}

export function snoozeChoices(now = new Date()): { label: string; at: number }[] {
	const at = (days: number, h: number) =>
		new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h).getTime();
	const t = now.getTime();
	return [
		{ label: '10 minutes', at: t + 600000 },
		{ label: '1 hour', at: t + 3600000 },
		...(now.getHours() < 17 ? [{ label: 'This evening, 6 PM', at: at(0, 18) }] : []),
		{ label: 'Tomorrow, 9 AM', at: at(1, 9) }
	];
}
