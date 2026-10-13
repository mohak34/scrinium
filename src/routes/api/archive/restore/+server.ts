import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { restore } from '$lib/server/bins';

// Unarchive { name } back to its original path (or "name (1)" when taken).
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.name !== 'string' || !body.name) throw error(400, 'Missing name');
	const restored = await restore('archive', body.name);
	return json({ path: restored.path });
};
