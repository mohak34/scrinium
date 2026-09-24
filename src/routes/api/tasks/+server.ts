import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import { listTasks, insertTask, type TaskStatus } from '$lib/server/db';

// Auth is already enforced in src/hooks.server.ts for everything under /api.

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];

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

function cleanRemind(v: unknown): number | null {
	if (v == null || v === '') return null;
	const n = typeof v === 'number' ? v : parseInt(String(v), 10);
	if (!Number.isFinite(n) || n < 0 || n > 10080) return null;
	return n;
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
	const note_path = typeof body?.note_path === 'string' && body.note_path ? body.note_path : null;
	const row = insertTask({
		id: randomUUID(),
		title,
		detail,
		status,
		due_at: cleanDue(body?.due_at),
		remind_min: cleanRemind(body?.remind_min),
		note_path
	});
	return json(row, { status: 201 });
};
