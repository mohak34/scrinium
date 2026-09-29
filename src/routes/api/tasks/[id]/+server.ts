import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTask, updateTask, deleteTask } from '$lib/server/db';

// Walk the parent chain to reject a reparent that would cycle.
function wouldCycle(id: string, parentId: string | null): boolean {
	let cur: string | null = parentId;
	for (let i = 0; i < 25 && cur; i++) {
		if (cur === id) return true;
		cur = getTask(cur)?.parent_id ?? null;
	}
	return false;
}

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
	if (body.priority !== undefined) {
		const ok = ['none', 'low', 'medium', 'high', 'urgent'].includes(body.priority);
		if (!ok) throw error(400, 'Bad priority');
		patch.priority = body.priority;
	}
	if (body.parent_id !== undefined) {
		if (body.parent_id !== null && typeof body.parent_id !== 'string')
			throw error(400, 'Bad parent');
		const parentId = body.parent_id || null;
		if (parentId === id) throw error(400, 'Bad parent');
		if (parentId && !getTask(parentId)) throw error(400, 'Bad parent');
		if (wouldCycle(id, parentId)) throw error(400, 'Bad parent');
		patch.parent_id = parentId;
	}
	if (body.due_at !== undefined) {
		if (body.due_at !== null && typeof body.due_at !== 'number') throw error(400, 'Bad due date');
		patch.due_at = body.due_at;
	}
	if (body.remind_at !== undefined) {
		if (body.remind_at !== null && typeof body.remind_at !== 'number')
			throw error(400, 'Bad reminder');
		patch.remind_at = body.remind_at;
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
