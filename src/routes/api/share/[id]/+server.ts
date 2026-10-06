import { json, error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { readNote, safeResolve } from '$lib/server/vault';
import { effectiveTitle } from '$lib/editor/frontmatter';
import { getShareSecret, mintProofToken, shareImages, verifySharePassword } from '$lib/server/shares';

// Public, no session needed (hooks.server.ts allowlists /api/share).
// A share is a live view: the markdown returned is the note's CURRENT file
// content on every request, never a snapshot.

async function payload(id: string, password: string | null) {
	const secret = getShareSecret(id);
	if (!secret) throw error(404, 'Share not found');
	if (secret.password_hash && (!password || !verifySharePassword(password, secret.password_hash))) {
		throw error(401, 'Password required');
	}
	let markdown: string;
	try {
		markdown = await readNote(secret.note_path);
	} catch {
		throw error(410, 'This note no longer exists');
	}
	// File mtime for the viewer's "updated …" line. Best-effort: a note
	// deleted between the read and the stat just reports no timestamp.
	let updatedAt: number | null = null;
	try {
		updatedAt = (await stat(safeResolve(secret.note_path))).mtimeMs;
	} catch {}
	return {
		id: secret.id,
		title: effectiveTitle(markdown, secret.note_path),
		markdown,
		notePath: secret.note_path.split('/').pop() ?? secret.note_path,
		updatedAt,
		hasPassword: !!secret.password_hash,
		// Image references the viewer may load, by index into
		// /api/share/<id>/assets/<n>.
		images: shareImages(markdown, secret.note_path).urls,
		// Proof token for loading the note's images without putting the
		// password in <img> URLs. Open shares pass none.
		proof: secret.password_hash ? mintProofToken(secret.id) : ''
	};
}

async function respond(id: string, password: string | null) {
	try {
		return json(await payload(id, password));
	} catch (e: unknown) {
		if ((e as { status?: number }).status === 401) {
			return json({ needsPassword: true }, { status: 401 });
		}
		throw e;
	}
}

// GET /api/share/<id> -> payload for open shares, 401 { needsPassword }
// for locked ones. Passwords are never accepted here: they travel in the
// POST body (or the x-share-password header), never in the URL where they
// would land in logs and browser history.
export const GET: RequestHandler = async ({ params, request }) => {
	if (!params.id) throw error(400, 'Invalid id');
	return respond(params.id, request.headers.get('x-share-password'));
};

// POST /api/share/<id> { password } -> payload, or 401 { needsPassword }.
export const POST: RequestHandler = async ({ params, request }) => {
	if (!params.id) throw error(400, 'Invalid id');
	const body = await request.json().catch(() => null);
	const password = typeof body?.password === 'string' ? body.password : null;
	return respond(params.id, password);
};
