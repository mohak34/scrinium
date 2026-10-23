import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTask, listTaskLinks, addTaskLink, removeTaskLink } from '$lib/server/db';
import { isNote, vaultRel } from '$lib/server/vault';

// Links are stored in canonical vault form ("./A//b.md" is "A/b.md"), so a
// rename moving them by prefix always finds them.
function cleanPath(v: unknown): string {
	if (typeof v !== 'string' || !v.trim()) throw error(400, 'Bad note path');
	return vaultRel(v.trim());
}

export const GET: RequestHandler = async ({ params }) => {
	if (!params.id || !getTask(params.id)) throw error(404, 'Task not found');
	return json(listTaskLinks(params.id));
};

// Only a live note can be linked; archived and trashed notes keep the links
// they had when they left.
export const POST: RequestHandler = async ({ params, request }) => {
	if (!params.id || !getTask(params.id)) throw error(404, 'Task not found');
	const body = await request.json().catch(() => null);
	const path = cleanPath(body?.note_path);
	if (!isNote(path)) throw error(404, `No note at ${path}`);
	return json(addTaskLink(params.id, path), { status: 201 });
};

// Links saved before paths were cleaned may be stored as sent, so the raw
// form is removed along with the canonical one.
export const DELETE: RequestHandler = async ({ params, url }) => {
	if (!params.id || !getTask(params.id)) throw error(404, 'Task not found');
	const raw = url.searchParams.get('note_path')?.trim().replace(/^\/+/, '') ?? '';
	removeTaskLink(params.id, raw);
	return json(removeTaskLink(params.id, cleanPath(raw)));
};
