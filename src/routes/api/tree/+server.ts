import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTree } from '$lib/server/vault';

export const GET: RequestHandler = async () => {
	const tree = await listTree();
	return json(tree);
};
