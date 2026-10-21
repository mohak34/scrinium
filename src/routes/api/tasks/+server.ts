import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import { listTasks, listTasksForNote, insertTask, getTask, getProject } from '$lib/server/db';
import { isPriority, isStatus } from '$lib/taskModel';
import { parseStamp, parseWaitingSince } from '$lib/server/taskInput';

// Auth is already enforced in src/hooks.server.ts for everything under /api.
// Older phone builds still send `area`; tasks group by project now, so it is
// ignored here and in PATCH.

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
	const badProject =
		body?.project != null && (typeof body.project !== 'string' || !getProject(body.project));
	if (!parent_id && badProject) throw error(400, 'Bad project');
	const row = insertTask({
		id: randomUUID(),
		title,
		detail,
		status,
		priority,
		waiting_on: cleanText(body?.waiting_on, 120),
		waiting_since: parseWaitingSince(body?.waiting_since),
		parent_id,
		// A subtask always carries its parent's project.
		project: parent_id ? parentProject : (body?.project ?? null),
		due_at: body?.due_at === undefined ? null : parseStamp(body.due_at, 'due date'),
		remind_at: body?.remind_at === undefined ? null : parseStamp(body.remind_at, 'reminder')
	});
	return json(row, { status: 201 });
};
