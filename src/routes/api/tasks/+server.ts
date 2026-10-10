import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import { listTasks, listTasksForNote, insertTask, getTask, getProject } from '$lib/server/db';
import { isArea, isPriority, isStatus } from '$lib/taskModel';
import { parseStamp } from '$lib/server/taskInput';

// Auth is already enforced in src/hooks.server.ts for everything under /api.

function cleanTitle(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim().slice(0, 200);
	return t ? t : null;
}

function cleanText(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim().slice(0, max);
	return t ? t : null;
}

// ?note=<path> narrows to tasks linked to that note (the note's right panel).
export const GET: RequestHandler = async ({ url }) => {
	const note = url.searchParams.get('note');
	return json(note ? listTasksForNote(note.replace(/^\/+/, '')) : listTasks());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = cleanTitle(body?.title);
	if (!title) throw error(400, 'Title is required');
	if (body?.status !== undefined && !isStatus(body.status)) throw error(400, 'Bad status');
	if (body?.area != null && !isArea(body.area)) throw error(400, 'Bad area');
	const status = isStatus(body?.status) ? body.status : 'todo';
	const detail = typeof body?.detail === 'string' ? body.detail.slice(0, 4000) : '';
	const priority = isPriority(body?.priority) ? body.priority : 'none';
	let parent_id: string | null = null;
	let parentProject: string | null = null;
	if (typeof body?.parent_id === 'string' && body.parent_id) {
		const parent = getTask(body.parent_id);
		if (!parent) throw error(400, 'Bad parent');
		parent_id = parent.id;
		parentProject = parent.project;
	}
	if (body?.project != null && (typeof body.project !== 'string' || !getProject(body.project)))
		throw error(400, 'Bad project');
	const row = insertTask({
		id: randomUUID(),
		title,
		detail,
		status,
		priority,
		area: isArea(body?.area) ? body.area : null,
		waiting_on: cleanText(body?.waiting_on, 120),
		parent_id,
		// A subtask joins its parent's project unless told otherwise.
		project: body?.project === undefined ? parentProject : body.project,
		due_at: body?.due_at === undefined ? null : parseStamp(body.due_at, 'due date'),
		remind_at: body?.remind_at === undefined ? null : parseStamp(body.remind_at, 'reminder')
	});
	return json(row, { status: 201 });
};
