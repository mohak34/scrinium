import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readAsset } from '$lib/server/vault';

const MIME_BY_EXT: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp'
};

export const GET: RequestHandler = async ({ params }) => {
	if (!params.path) throw error(400, 'Invalid path');
	const ext = params.path.split('.').pop()?.toLowerCase() ?? '';
	const mime = MIME_BY_EXT[ext];
	if (!mime) throw error(415, 'Unsupported asset type');
	const data = await readAsset(params.path);
	return new Response(new Uint8Array(data), {
		headers: {
			'Content-Type': mime,
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
