import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import { listTasks, insertTask, getTask, type TaskStatus, type TaskPriority } from '$lib/server/db';

// Auth is already enforced in src/hooks.server.ts for everything under /api.

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high', 'urgent'];

function cleanTitle(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim().slice(0, 200);
	return t ? t : null;
}

function cleanStatus(v: unknown): TaskStatus {
	return v === 'doing' || v === 'done' || v === 'todo' ? v : 'todo';
}

function cleanDue(v: unknown): number | null {
	if (v == null || v === '') return null;
	const n = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
	return Number.isFinite(n) ? n : null;
}

function cleanStamp(v: unknown): number | null {
	if (v == null || v === '') return null;
	const n = typeof v === 'number' ? v : NaN;
	return Number.isFinite(n) && n >= 0 ? n : null;
}

export const GET: RequestHandler = async () => {
	return json(listTasks());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = cleanTitle(body?.title);
	if (!title) throw error(400, 'Title is required');
	const status = cleanStatus(body?.status);
	if (body?.status !== undefined && !STATUSES.includes(body.status)) throw error(400, 'Bad status');
	const detail = typeof body?.detail === 'string' ? body.detail.slice(0, 4000) : '';
	const priority: TaskPriority =
		typeof body?.priority === 'string' && (PRIORITIES as string[]).includes(body.priority)
			? body.priority
			: 'none';
	let parent_id: string | null = null;
	if (typeof body?.parent_id === 'string' && body.parent_id) {
		if (!getTask(body.parent_id)) throw error(400, 'Bad parent');
		parent_id = body.parent_id;
	}
	const row = insertTask({
		id: randomUUID(),
		title,
		detail,
		status,
		priority,
		parent_id,
		due_at: cleanDue(body?.due_at),
		remind_at: cleanStamp(body?.remind_at)
	});
	return json(row, { status: 201 });
};
