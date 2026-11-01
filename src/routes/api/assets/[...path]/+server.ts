import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assetResponse, MAX_UPLOAD_BYTES } from '$lib/server/assets';
import { replaceAssetStream } from '$lib/server/vault';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!params.path) throw error(400, 'Invalid path');
	return assetResponse(params.path, request);
};

// Overwrites an existing file with the raw body (the PDF viewer saving
// annotations). With `If-Match: <X-Asset-Version>` a file changed since then
// is kept and the body is saved beside it as a conflict copy; the answer
// says where it landed. New files go through POST /api/attachments.
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!params.path) throw error(400, 'Invalid path');
	if (!request.body) throw error(400, 'No file provided (send it as the body, with a Content-Type header)');
	if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES) {
		throw error(413, `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
	}
	return json(
		await replaceAssetStream(params.path, request.body, MAX_UPLOAD_BYTES, request.headers.get('if-match'))
	);
};
