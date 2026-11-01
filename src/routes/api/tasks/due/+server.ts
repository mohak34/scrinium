import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDueReminders, listFiredReminders, markRemindersNotified } from '$lib/server/db';

// Returns reminders that just became due and marks them fired in the same
// call, so a second tab polling a moment later won't double-notify.
export const POST: RequestHandler = async () => {
	const now = Date.now();
	const due = listDueReminders(now);
	markRemindersNotified(
		due.map((t) => t.id),
		now
	);
	return json(due);
};

// Every fired reminder still open, for the reminder inbox.
export const GET: RequestHandler = async () => json(listFiredReminders());
