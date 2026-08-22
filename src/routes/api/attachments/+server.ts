import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeAsset, safeResolve } from '$lib/server/vault';
import { randomBytes } from 'node:crypto';

const ALLOWED_TYPES: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/gif': '.gif',
	'image/webp': '.webp'
};

const MAX_BYTES = 10 * 1024 * 1024;

// Client picks the folder (per its attachment settings); we only trust it
// after re-validation here. A folder must be a relative subpath of safe
// segments - no traversal, no dotfiles. '' means vault root.
function validateFolder(raw: unknown): string {
	if (raw == null || raw === '') return 'attachments';
	if (typeof raw !== 'string') throw error(400, 'Invalid folder');
	const segs = raw.split('/').filter(Boolean);
	if (!segs.length) return 'attachments';
	for (const s of segs) {
		if (s === '.' || s === '..' || s.startsWith('.') || /[\\:*?"<>|]/.test(s)) {
			throw error(400, 'Invalid folder');
		}
	}
	const rel = segs.join('/');
	safeResolve(rel); // throws 400 if it escapes the vault
	return rel;
}

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File) || !form) throw error(400, 'No file provided');
	if (file.size === 0) throw error(400, 'Empty file');
	if (file.size > MAX_BYTES) throw error(413, 'File too large (max 10 MB)');
	const ext = ALLOWED_TYPES[file.type];
	if (!ext) throw error(415, 'Unsupported image type (png, jpeg, gif, webp only)');

	const folder = validateFolder(form.get('folder'));
	const name = `${Date.now()}-${randomBytes(4).toString('hex')}${ext}`;
	await writeAsset(`${folder}/${name}`, Buffer.from(await file.arrayBuffer()));
	return json({ path: `${folder}/${name}` });
};
