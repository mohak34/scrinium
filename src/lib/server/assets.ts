import { Readable } from 'node:stream';
import { openAsset } from './vault';

// Largest upload or replacement. Must stay under BODY_SIZE_LIMIT in
// deploy/scrinium.service.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// Types a browser may show in the page. Everything else (html, svg, js,
// archives, ...) goes out as an opaque download: a vault file served inline
// from our origin would run with the user's session.
const INLINE: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	pdf: 'application/pdf',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	mp4: 'video/mp4',
	webm: 'video/webm',
	txt: 'text/plain; charset=utf-8',
	csv: 'text/plain; charset=utf-8',
	json: 'text/plain; charset=utf-8'
};

// Streams a vault file back with headers that keep it inert. `sandbox` also
// covers anything that slips past the type list; Chrome refuses to render
// PDFs under it, and its PDF viewer is isolated already, so PDFs skip it.
// Browsers revalidate every read (a 304 when the version still matches), so
// an overwritten file never shows stale. Single byte ranges are served so
// pdf.js can show the first pages of a big PDF before the rest arrives; with
// `?v=<version>` a file that changed since answers 412 instead of mixing
// bytes from two versions.
export async function assetResponse(relPath: string, request: Request): Promise<Response> {
	const { size, version, open } = await openAsset(relPath);
	const name = relPath.split('/').pop() ?? 'file';
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	const type = INLINE[ext];
	const etag = `"${version}"`;
	const headers: Record<string, string> = {
		'Content-Type': type ?? 'application/octet-stream',
		'Content-Disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
		'Cache-Control': 'private, no-cache',
		ETag: etag,
		'Accept-Ranges': 'bytes',
		'X-Content-Type-Options': 'nosniff',
		// Sent back as If-Match by PUT /api/assets (the PDF pane).
		'X-Asset-Version': version
	};
	if (ext !== 'pdf') headers['Content-Security-Policy'] = 'sandbox';
	const wanted = new URL(request.url).searchParams.get('v');
	if (wanted !== null && wanted !== version) return new Response(null, { status: 412, headers });
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });

	let start = 0;
	let end = size - 1;
	let status = 200;
	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	const ifRange = request.headers.get('if-range');
	if (range && (range[1] || range[2]) && (!ifRange || ifRange === etag)) {
		if (range[1]) {
			start = Number(range[1]);
			if (range[2]) end = Math.min(Number(range[2]), size - 1);
		} else start = Math.max(0, size - Number(range[2]));
		if (start > end || start >= size) {
			headers['Content-Range'] = `bytes */${size}`;
			return new Response(null, { status: 416, headers });
		}
		headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
		status = 206;
	}
	headers['Content-Length'] = String(end - start + 1);
	if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers });
	const body = Readable.toWeb(open(start, end)) as ReadableStream<Uint8Array>;
	return new Response(body, { status, headers });
}
