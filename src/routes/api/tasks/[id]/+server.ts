import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTask, updateTask, deleteTask } from '$lib/server/db';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) throw error(400, 'Missing id');
	if (!getTask(id)) throw error(404, 'Task not found');
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request');

	const patch: Parameters<typeof updateTask>[1] = {};
	if (body.title !== undefined) {
		if (typeof body.title !== 'string' || !body.title.trim()) throw error(400, 'Bad title');
		patch.title = body.title.trim().slice(0, 200);
	}
	if (body.detail !== undefined) {
		if (typeof body.detail !== 'string') throw error(400, 'Bad detail');
		patch.detail = body.detail.slice(0, 4000);
	}
	if (body.status !== undefined) {
		if (body.status !== 'todo' && body.status !== 'doing' && body.status !== 'done')
			throw error(400, 'Bad status');
		patch.status = body.status;
	}
	if (body.due_at !== undefined) {
		if (body.due_at !== null && typeof body.due_at !== 'number') throw error(400, 'Bad due date');
		patch.due_at = body.due_at;
	}
	if (body.remind_min !== undefined) {
		if (body.remind_min !== null && typeof body.remind_min !== 'number')
			throw error(400, 'Bad reminder');
		patch.remind_min = body.remind_min;
	}
	if (body.note_path !== undefined) {
		if (body.note_path !== null && typeof body.note_path !== 'string')
			throw error(400, 'Bad note link');
		patch.note_path = body.note_path || null;
	}
	if (body.position !== undefined) {
		if (typeof body.position !== 'number' || !Number.isFinite(body.position))
			throw error(400, 'Bad position');
		patch.position = body.position;
	}
	const row = updateTask(id, patch);
	return json(row);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id) throw error(400, 'Missing id');
	deleteTask(id);
	return json({ ok: true });
};
