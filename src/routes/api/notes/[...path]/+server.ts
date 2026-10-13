import { json, text, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	readNote,
	writeNote,
	createFolder,
	renamePath,
	isFolder,
	isHiddenPath,
	vaultRel
} from '$lib/server/vault';
import { moveIn } from '$lib/server/bins';
import { effectiveTitle } from '$lib/editor/frontmatter';
import {
	upsertNoteMeta,
	renameNoteMeta,
	indexNote,
	renameNoteIndex,
	renameTaskLinks,
	renameProjects
} from '$lib/server/db';
import { renameShares } from '$lib/server/shares';

// Auth is already enforced in src/hooks.server.ts for everything under /api
// except /api/auth itself - see that file for the actual gate.

// Reads reach archived notes (".archive/..."), so the archive page and
// agents can open them. Writes never touch a dot folder: archived notes are
// read-only, and bins change only through /api/archive and /api/trash.
// Canonical ("a/b.md", never "./a/b.md"), so the cache, shares and task
// links all store the same spelling and prefix lookups find them.
function writable(path: string | undefined): string {
	if (!path || isHiddenPath(path)) throw error(400, 'Invalid path');
	return vaultRel(path);
}

export const GET: RequestHandler = async ({ params }) => {
	if (!params.path) throw error(400, 'Invalid path');
	const content = await readNote(params.path);
	return text(content);
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const path = writable(params.path);
	const content = await request.text();
	await writeNote(path, content);

	const title = effectiveTitle(content, path);
	upsertNoteMeta(path, title, Date.now());
	indexNote(path, title, content);

	return new Response(null, { status: 204 });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const path = writable(params.path);
	const body = await request.json().catch(() => null);
	if (!body?.folder) throw error(400, 'Invalid request');
	await createFolder(path);
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const from = writable(params.path);
	const body = await request.json().catch(() => null);
	if (!body?.newPath || typeof body.newPath !== 'string') throw error(400, 'Invalid request');
	const to = writable(body.newPath);
	await renamePath(from, to);
	renameNoteMeta(from, to);
	renameNoteIndex(from, to);
	renameShares(from, to);
	renameTaskLinks(from, to);
	renameProjects(vaultRel(from), vaultRel(to), isFolder);
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await moveIn('trash', writable(params.path));
	return new Response(null, { status: 204 });
};
