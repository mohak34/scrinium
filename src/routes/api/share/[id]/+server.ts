import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNote } from '$lib/server/vault';
import { effectiveTitle } from '$lib/editor/frontmatter';
import { getShareSecret, mintProofToken, verifySharePassword } from '$lib/server/shares';

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
	return {
		id: secret.id,
		title: effectiveTitle(markdown, secret.note_path),
		markdown,
		notePath: secret.note_path.split('/').pop() ?? secret.note_path,
		hasPassword: !!secret.password_hash,
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

// GET /api/share/<id>[?password=...] -> payload, or 401 when locked.
export const GET: RequestHandler = async ({ params, url, request }) => {
	if (!params.id) throw error(400, 'Invalid id');
	const fromQuery = url.searchParams.get('password');
	const fromHeader = request.headers.get('x-share-password');
	return respond(params.id, fromQuery ?? fromHeader);
};

// POST /api/share/<id> { password } -> payload, or 401 { needsPassword }.
export const POST: RequestHandler = async ({ params, request }) => {
	if (!params.id) throw error(400, 'Invalid id');
	const body = await request.json().catch(() => null);
	const password = typeof body?.password === 'string' ? body.password : null;
	return respond(params.id, password);
};
