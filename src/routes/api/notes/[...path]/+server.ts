import { json, text, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNote, writeNote, createFolder, renamePath, moveToTrash } from '$lib/server/vault';
import { effectiveTitle } from '$lib/editor/frontmatter';
import {
	upsertNoteMeta,
	deleteNoteMetaByPrefix,
	renameNoteMeta,
	indexNote,
	deleteNoteIndexByPrefix,
	renameNoteIndex,
	renameTaskLinks
} from '$lib/server/db';
import { deleteSharesByPrefix, renameShares } from '$lib/server/shares';

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

	const title = effectiveTitle(content, params.path);
	upsertNoteMeta(params.path, title, Date.now());
	indexNote(params.path, title, content);

	return new Response(null, { status: 204 });
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
	renameNoteIndex(params.path, body.newPath);
	renameShares(params.path, body.newPath);
	renameTaskLinks(params.path, body.newPath);
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!params.path) throw error(400, 'Invalid path');
	await moveToTrash(params.path);
	deleteNoteMetaByPrefix(params.path);
	deleteNoteIndexByPrefix(params.path);
	deleteSharesByPrefix(params.path);
	return new Response(null, { status: 204 });
};
