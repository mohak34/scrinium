import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assetResponse } from '$lib/server/assets';

export const GET: RequestHandler = async ({ params }) => {
	if (!params.path) throw error(400, 'Invalid path');
	return assetResponse(params.path);
};
