import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNote } from '$lib/server/vault';
import { createShare, listSharesForNote } from '$lib/server/shares';

// Auth is enforced in hooks.server.ts - these endpoints need a session.

// GET /api/shares?path=Notes/foo.md -> shares for that note, newest first.
export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	if (!path) throw error(400, 'Missing path');
	return json(listSharesForNote(path));
};

// POST /api/shares { path, password? } -> { id, notePath, hasPassword }.
// The public URL is origin + /s/<id>, built client-side. Password is
// optional; 4+ chars when present. Only .md notes, and the file must exist.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const path = typeof body?.path === 'string' ? body.path : '';
	const password = body?.password === undefined ? undefined : String(body.password);
	if (!path || !path.endsWith('.md')) throw error(400, 'Only markdown notes can be shared');
	if (password !== undefined && (password.length < 4 || password.length > 200)) {
		throw error(400, 'Password must be 4-200 characters');
	}
	await readNote(path); // 404 when the file does not exist
	const email = locals.session?.user?.email ?? null;
	return json(createShare(path, email, password || undefined), { status: 201 });
};
