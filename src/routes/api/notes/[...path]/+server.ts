import { json, text, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	readNote,
	writeNote,
	saveNote,
	noteVersion,
	createNoteFile,
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
	renameProjects,
	getProject
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

// Every read and write answers with the note's version (X-Note-Version), a
// hash of its text; the browser sends it back as If-Match.
export const GET: RequestHandler = async ({ params }) => {
	if (!params.path) throw error(400, 'Invalid path');
	const content = await readNote(params.path);
	return text(content, { headers: { 'X-Note-Version': noteVersion(content) } });
};

function indexed(path: string, content: string) {
	const title = effectiveTitle(content, path);
	upsertNoteMeta(path, title, Date.now());
	indexNote(path, title, content);
}

// `If-None-Match: *` asks for create-only: 409 instead of overwriting.
// `If-Match: <version>` saves over that version only (saveNote) and answers
// with where the text landed and any conflict copy; without either the
// note is overwritten (agents, the phone).
export const PUT: RequestHandler = async ({ params, request }) => {
	const path = writable(params.path);
	const content = await request.text();
	const version = request.headers.get('if-match');
	if (version) {
		const saved = await saveNote(path, content, version);
		indexed(saved.path, saved.content);
		if (saved.conflict) indexed(saved.conflict.path, saved.conflict.content);
		return json(
			{ path: saved.path, conflict: saved.conflict?.path ?? null },
			{ headers: { 'X-Note-Version': noteVersion(saved.content) } }
		);
	}
	if (request.headers.get('if-none-match') === '*') await createNoteFile(path, content);
	else await writeNote(path, content);
	indexed(path, content);
	return new Response(null, { status: 204, headers: { 'X-Note-Version': noteVersion(content) } });
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
	// Same path: nothing moves, and the bookkeeping below would drop the
	// note's own task links and index row as "stale rows at the target".
	if (from === to) return json({ relinked: [] });
	// Projects are folders at the vault root; nested, the row would point
	// at a folder the sidebar never shows as one.
	if (getProject(vaultRel(from)) && vaultRel(to).includes('/')) {
		throw error(400, 'A project folder stays at the vault root');
	}
	const relinked = await renamePath(from, to, () => {
		renameNoteMeta(from, to);
		renameNoteIndex(from, to);
		renameShares(from, to);
		renameTaskLinks(from, to);
		renameProjects(vaultRel(from), vaultRel(to), isFolder);
	});
	// Notes whose links or title the move rewrote; the editor fixes its
	// copy of the open one the same way (relinkNote, retitle). Archived ones stay
	// searchable but have no metadata, like every binned note; trashed ones
	// stay out of the index.
	for (const n of relinked) {
		if (n.path.startsWith('.trash/')) continue;
		const title = effectiveTitle(n.content, n.path);
		if (!isHiddenPath(n.path)) upsertNoteMeta(n.path, title, Date.now());
		indexNote(n.path, title, n.content);
	}
	// Versions let the browser keep saving the notes the move rewrote.
	return json({
		relinked: relinked.map((n) => n.path),
		versions: Object.fromEntries(relinked.map((n) => [n.path, noteVersion(n.content)]))
	});
};

export const DELETE: RequestHandler = async ({ params }) => {
	await moveIn('trash', writable(params.path));
	return new Response(null, { status: 204 });
};
