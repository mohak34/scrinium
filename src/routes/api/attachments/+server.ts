import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeAsset } from '$lib/server/vault';
import { randomBytes } from 'node:crypto';

const ALLOWED_TYPES: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/gif': '.gif',
	'image/webp': '.webp'
};

const MAX_BYTES = 10 * 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) throw error(400, 'No file provided');
	if (file.size === 0) throw error(400, 'Empty file');
	if (file.size > MAX_BYTES) throw error(413, 'File too large (max 10 MB)');
	const ext = ALLOWED_TYPES[file.type];
	if (!ext) throw error(415, 'Unsupported image type (png, jpeg, gif, webp only)');

	const name = `${Date.now()}-${randomBytes(4).toString('hex')}${ext}`;
	await writeAsset(`attachments/${name}`, Buffer.from(await file.arrayBuffer()));
	return json({ path: `attachments/${name}` });
};
