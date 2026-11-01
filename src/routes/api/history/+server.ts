import { json, text, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { history } from '$lib/server/db';
import { vaultRel } from '$lib/server/vault';

// GET /api/history?note=<path> -> the note's versions, newest first, with
// `mine` on the caller's own; &id=<n> -> that version's text. Restoring is
// a plain note PUT with `X-Note-Restore: 1`.
export const GET: RequestHandler = async ({ url, locals }) => {
	const note = url.searchParams.get('note');
	if (!note) throw error(400, 'Missing note');
	const path = vaultRel(note);
	const id = url.searchParams.get('id');
	if (id !== null) {
		const content = history.content(path, Number(id));
		if (content === null) throw error(404, 'Version not found');
		return text(content);
	}
	return json(history.list(path).map((v) => ({ ...v, mine: v.author === locals.email })));
};
