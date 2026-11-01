import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isHiddenPath, vaultRel, whileNoteExists } from '$lib/server/vault';
import { createShare, listAllShares, listSharesForNote } from '$lib/server/shares';
import { MAX_SHARE_DAYS } from '$lib/shareExpiry';

// Auth is enforced in hooks.server.ts - these endpoints need a session.

// GET /api/shares?path=Notes/foo.md -> shares for that note, newest first.
// Without ?path, every share in the vault grouped by note.
export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	return json(path ? listSharesForNote(vaultRel(path)) : listAllShares());
};

// POST /api/shares { path, password?, expiresInDays? } -> the new link.
// Without expiresInDays (1-365) it never expires.
// The public URL is origin + /s/<id>, built client-side. Password is
// optional; 4+ chars when present. Only .md notes, and the file must exist.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	// Stored canonical ("a/b.md", never "./a/b.md"), so renames, archive
	// and delete find it by prefix.
	const path = typeof body?.path === 'string' ? vaultRel(body.path) : '';
	const password = body?.password === undefined ? undefined : String(body.password);
	if (!path || !/\.md$/i.test(path)) throw error(400, 'Only markdown notes can be shared');
	// Archived and trashed notes are put away; their links were dropped.
	if (isHiddenPath(path)) throw error(400, 'Archived and trashed notes cannot be shared');
	if (password !== undefined && (password.length < 4 || password.length > 200)) {
		throw error(400, 'Password must be 4-200 characters');
	}
	const days = body?.expiresInDays;
	if (days != null && (!Number.isInteger(days) || days < 1 || days > MAX_SHARE_DAYS)) {
		throw error(400, `expiresInDays must be a whole number from 1 to ${MAX_SHARE_DAYS}`);
	}
	const expiresAt = days == null ? null : Date.now() + days * 86_400_000;
	const email = locals.session?.user?.email ?? null;
	// 404 when the file does not exist; a delete never slips in between.
	const share = await whileNoteExists(path, () => createShare(path, email, password || undefined, expiresAt));
	return json(share, { status: 201 });
};
