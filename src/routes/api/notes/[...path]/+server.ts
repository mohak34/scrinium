import { json, text, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNote, writeNote, createFolder, renamePath, moveToTrash } from '$lib/server/vault';
import { upsertNoteMeta, deleteNoteMetaByPrefix, renameNoteMeta } from '$lib/server/db';

// Auth is already enforced in src/hooks.server.ts for everything under /api
// except /api/auth itself - see that file for the actual gate.

export const GET: RequestHandler = async ({ params }) => {
	if (!params.path) throw error(400, 'Invalid path');
	const content = await readNote(params.path);
	return text(content);
};

export const PUT: RequestHandler = async ({ params, request }) => {
	if (!params.path) throw error(400, 'Invalid path');
	const content = await request.text();
	await writeNote(params.path, content);

	const title = content.split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 200) || params.path;
	upsertNoteMeta(params.path, title, Date.now());

	return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!params.path) throw error(400, 'Invalid path');
	const body = await request.json().catch(() => null);
	if (!body?.folder) throw error(400, 'Invalid request');
	await createFolder(params.path);
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!params.path) throw error(400, 'Invalid path');
	const body = await request.json().catch(() => null);
	if (!body?.newPath || typeof body.newPath !== 'string') throw error(400, 'Invalid request');
	await renamePath(params.path, body.newPath);
	renameNoteMeta(params.path, body.newPath);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!params.path) throw error(400, 'Invalid path');
	await moveToTrash(params.path);
	deleteNoteMetaByPrefix(params.path);
	return json({ ok: true });
};
