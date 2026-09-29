import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTask, listTaskLinks, addTaskLink, removeTaskLink } from '$lib/server/db';

function cleanPath(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const p = v.trim().replace(/^\/+/, '').slice(0, 500);
	return p ? p : null;
}

export const GET: RequestHandler = async ({ params }) => {
	if (!params.id || !getTask(params.id)) throw error(404, 'Task not found');
	return json(listTaskLinks(params.id));
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!params.id || !getTask(params.id)) throw error(404, 'Task not found');
	const body = await request.json().catch(() => null);
	const path = cleanPath(body?.note_path);
	if (!path) throw error(400, 'Bad note path');
	return json(addTaskLink(params.id, path), { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
	if (!params.id || !getTask(params.id)) throw error(404, 'Task not found');
	const path = cleanPath(url.searchParams.get('note_path'));
	if (!path) throw error(400, 'Bad note path');
	return json(removeTaskLink(params.id, path));
};
