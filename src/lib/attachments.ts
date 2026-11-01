import { relativeTo } from './relink';

// Vault files that render as images: editor embeds, share pages, MCP reads.
// Shared by client and server so all three agree.
export const isImagePath = (p: string) => /\.(png|jpe?g|gif|webp|avif)$/i.test(p);

// Turn a markdown image reference into a browser-loadable URL. Absolute
// (http(s)/data) URLs pass through; anything else is resolved against the
// note's folder and served through the auth-gated asset API. Shared by the
// editor, the note renderer and share pages so images resolve identically.
// A destination may be written in angle brackets and percent-encoded
// (`<my img.png>`, `my%20img.png`); both reach the same file. A `?query`
// or `#fragment` (`doc.pdf#page=2`) rides along after the asset path.
export function resolveAssetUrl(url: string, noteDir: string | null): string | null {
	let clean = url.trim();
	if (clean.startsWith('<') && clean.endsWith('>')) clean = clean.slice(1, -1).trim();
	if (!clean) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('/')) return clean;
	const cut = clean.search(/[?#]/);
	const suffix = cut < 0 ? '' : clean.slice(cut);
	if (cut >= 0) clean = clean.slice(0, cut);
	// The note's folder is a real path; only the destination is decoded.
	const parts = noteDir ? noteDir.split('/') : [];
	for (const seg of clean.split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..') {
			parts.pop();
			continue;
		}
		parts.push(decodeSegment(seg));
	}
	if (!parts.length) return null;
	return '/api/assets/' + parts.map(encodeURIComponent).join('/') + suffix;
}

function decodeSegment(seg: string): string {
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

// The reference to put in a note for an uploaded file: an embed for images,
// a plain link for anything else.
export function attachmentMarkdown(vaultRel: string, notePath: string | null): string {
	// Markdown links resolve against the note's folder (see resolveAssetUrl);
	// uploads return vault-relative paths.
	const rel = notePath ? relativeTo(notePath.split('/').slice(0, -1).join('/'), vaultRel) : vaultRel;
	const file = vaultRel.split('/').pop() ?? vaultRel;
	return isImagePath(vaultRel) ? `![${file.replace(/\.[^.]+$/, '')}](${rel})` : `[${file}](${rel})`;
}
