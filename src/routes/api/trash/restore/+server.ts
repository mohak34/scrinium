import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { restore } from '$lib/server/bins';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const trashName = typeof body?.trashName === 'string' ? body.trashName : '';
	if (!trashName) throw error(400, 'Missing trashName');
	const restored = await restore('trash', trashName);
	return json({ ok: true, path: restored.path });
};
