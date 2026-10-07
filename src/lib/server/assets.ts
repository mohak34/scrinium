import { Readable } from 'node:stream';
import { openAsset } from './vault';

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
export async function assetResponse(relPath: string): Promise<Response> {
	const { stream, size } = await openAsset(relPath);
	const name = relPath.split('/').pop() ?? 'file';
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	const type = INLINE[ext];
	const headers: Record<string, string> = {
		'Content-Type': type ?? 'application/octet-stream',
		'Content-Length': String(size),
		'Content-Disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
		'Cache-Control': 'private, max-age=3600',
		'X-Content-Type-Options': 'nosniff'
	};
	if (ext !== 'pdf') headers['Content-Security-Policy'] = 'sandbox';
	return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
}
