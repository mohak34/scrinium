import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNote } from '$lib/server/vault';
import { assetResponse } from '$lib/server/assets';
import { isImagePath } from '$lib/attachments';
import { checkProofToken, getShareSecret, shareImages } from '$lib/server/shares';

// Public sibling of /api/assets for shared notes: /assets/<n> is the n-th
// image the note currently references (see shareImages), never an arbitrary
// vault path. Password shares need the ?proof= token from a successful
// unlock, so the password itself never lands in <img> URLs or server logs.
export const GET: RequestHandler = async ({ params, url }) => {
	const secret = params.id ? getShareSecret(params.id) : undefined;
	if (!secret) throw error(404, 'Share not found');
	if (secret.password_hash && !checkProofToken(secret.id, url.searchParams.get('proof'))) {
		throw error(401, 'Password required');
	}
	if (!/^\d{1,4}$/.test(params.path ?? '')) throw error(404, 'Not found');
	let markdown: string;
	try {
		markdown = await readNote(secret.note_path);
	} catch {
		throw error(404, 'Not found');
	}
	const path = shareImages(markdown, secret.note_path).paths[Number(params.path)];
	if (!path || !isImagePath(path)) throw error(404, 'Not found');
	return assetResponse(path);
};
