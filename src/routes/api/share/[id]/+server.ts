import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openShare } from '$lib/server/shares';

// Public, no session needed (hooks.server.ts allowlists /api/share). The
// /s/<id> page renders open links on the server; this is how a locked one
// unlocks.

async function respond(id: string, password: string | null) {
	try {
		return json(await openShare(id, password));
	} catch (e: unknown) {
		if ((e as { status?: number }).status === 401) {
			return json({ needsPassword: true }, { status: 401 });
		}
		throw e;
	}
}

// GET /api/share/<id> -> the rendered note for open links, 401
// { needsPassword } for locked ones. Passwords are never accepted in the
// URL, where they would land in logs and browser history: they travel in
// the POST body or the x-share-password header.
export const GET: RequestHandler = async ({ params, request }) => {
	if (!params.id) throw error(400, 'Invalid id');
	return respond(params.id, request.headers.get('x-share-password'));
};

// POST /api/share/<id> { password } -> the rendered note, or 401 { needsPassword }.
export const POST: RequestHandler = async ({ params, request }) => {
	if (!params.id) throw error(400, 'Invalid id');
	const body = await request.json().catch(() => null);
	const password = typeof body?.password === 'string' ? body.password : null;
	return respond(params.id, password);
};
