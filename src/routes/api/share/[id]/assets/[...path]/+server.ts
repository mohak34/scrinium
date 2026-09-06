import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readAsset } from '$lib/server/vault';
import { checkProofToken, getShareSecret } from '$lib/server/shares';

const MIME_BY_EXT: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp'
};

// Public sibling of /api/assets for shared notes. Open shares load freely;
// password shares need the ?proof= token from a successful unlock, so the
// password itself never lands in <img> URLs or server logs.
export const GET: RequestHandler = async ({ params, url }) => {
	if (!params.id || !params.path) throw error(400, 'Invalid path');
	const secret = getShareSecret(params.id);
	if (!secret) throw error(404, 'Share not found');
	if (secret.password_hash && !checkProofToken(secret.id, url.searchParams.get('proof'))) {
		throw error(401, 'Password required');
	}
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
