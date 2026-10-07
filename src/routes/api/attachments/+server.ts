import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeAssetStream, safeResolve } from '$lib/server/vault';

// Any file type is accepted; /api/assets decides what is safe to show inline.
// Must stay under BODY_SIZE_LIMIT in deploy/scrinium.service.
const MAX_BYTES = 100 * 1024 * 1024;

// Client picks the folder (per its attachment settings); we only trust it
// after re-validation here. A folder must be a relative subpath of safe
// segments - no traversal, no dotfiles. '' means vault root.
function validateFolder(raw: string | null): string {
	if (raw == null || raw === '') return 'attachments';
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

// Keep the uploader's filename, minus anything unsafe on disk or that would
// break a markdown link (spaces become dashes for the same reason). Notes go
// through the notes API so they get indexed and title-synced.
function validateName(raw: string | null): string {
	const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
	const name = base
		.replace(/[\x00-\x1f:*?"<>|#%[\]()^]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/^[.-]+/, '')
		.slice(-120);
	if (!name) return `file-${Date.now()}`;
	if (/\.md$/i.test(name)) throw error(400, 'Notes go through /api/notes, not attachments');
	return name;
}

// Raw body, not multipart: POST /api/attachments?name=report.pdf&folder=...
// The body streams straight to disk, so memory stays flat at any size. PUT
// is the same, for `curl -T`. SvelteKit drops bodies without a Content-Type,
// so callers must send one (any value).
export const POST: RequestHandler = async ({ request, url }) => {
	if (!request.body) throw error(400, 'No file provided (send it as the body, with a Content-Type header)');
	if (Number(request.headers.get('content-length')) > MAX_BYTES) {
		throw error(413, `File too large (max ${MAX_BYTES / 1024 / 1024} MB)`);
	}
	const folder = validateFolder(url.searchParams.get('folder'));
	const name = validateName(url.searchParams.get('name'));
	const path = await writeAssetStream(folder, name, request.body, MAX_BYTES);
	return json({ path });
};

export const PUT = POST;
