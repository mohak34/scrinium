import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { manifestNotes } from '$lib/server/vault';

export const GET: RequestHandler = async () => {
	return json(await manifestNotes());
};