// Relative markdown links ([text](url), ![alt](url), [ref]: url) point at
// vault files by path from the note's folder, so moving a note, or a file it
// links to, breaks them. relinkNote rewrites them to keep pointing at the
// same files. Shared by the notes route (on every rename or move) and the
// editor (the open note), so both produce the same text. Links are found by
// the same Lezer markdown parser the editor uses, so code is never touched.

import { parser, GFM } from '@lezer/markdown';

const markdown = parser.configure(GFM);
// Syntax nodes whose URL child is a link destination (not a bare autolink).
const LINK_NODES = new Set(['Link', 'Image', 'LinkReference']);

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

function decode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

// Vault path a link url reaches from dir, or null for external, absolute and
// anchor-only urls. ".." past the vault root stays at the root, like
// resolveAssetUrl in the editor.
function resolveLink(dir: string, url: string): string | null {
	if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/')) return null;
	const parts = dir ? dir.split('/') : [];
	for (const seg of url.split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..') parts.pop();
		else parts.push(seg);
	}
	return parts.length ? parts.join('/') : null;
}

// Path from a note's folder to a vault file, e.g. "../attachments/a.png".
export function relativeTo(dir: string, target: string): string {
	const from = dir ? dir.split('/') : [];
	const to = target.split('/');
	let i = 0;
	while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
	return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

interface Link {
	// The url's path as written (decoded), and the vault path it reaches.
	path: string;
	target: string;
	// The url rebuilt around a new path; keeps the ?query/#anchor, angle
	// brackets and percent-encoding of the original.
	rewrite(path: string): string;
}

// Calls fn for each relative link destination outside code; fn returns the
// new url or null to keep it.
function mapLinks(content: string, dir: string, fn: (link: Link) => string | null): string {
	const edits: { from: number; to: number; text: string }[] = [];
	markdown.parse(content).iterate({
		enter(node) {
			if (node.name !== 'URL' || !LINK_NODES.has(node.node.parent?.name ?? '')) return;
			const raw = content.slice(node.from, node.to);
			const angle = raw.startsWith('<');
			const url = angle ? raw.slice(1, -1) : raw;
			const cut = url.search(/[?#]/);
			const [pathPart, suffix] = cut < 0 ? [url, ''] : [url.slice(0, cut), url.slice(cut)];
			const path = decode(pathPart);
			const target = resolveLink(dir, path);
			if (target === null) return;
			const encoded = !angle && path !== pathPart;
			const text = fn({
				path,
				target,
				rewrite(next) {
					// Encode per segment so a "#" or "?" in a file name never reads as a
					// fragment or query, and parens never close the link early.
					if (encoded) return encodeSegments(next) + suffix;
					const url = next + suffix;
					return angle || /[\s()<>]/.test(url) ? `<${url}>` : url;
				}
			});
			if (text !== null) edits.push({ from: node.from, to: node.to, text });
		}
	});
	let out = content;
	for (const e of edits.reverse()) out = out.slice(0, e.from) + e.text + out.slice(e.to);
	return out;
}

const encodeSegments = (p: string) =>
	p
		.split('/')
		.map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29'))
		.join('/');

// Maps a vault path through a rename of `from` (a file or folder) to `to`.
export function movedBy(from: string, to: string): (p: string) => string {
	return (p) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p);
}

// The note's text with relative links fixed after a move: the note itself
// went from oldPath to newPath (the same path when it did not move), and
// `moved` maps every vault path to where it is now. Links that already
// point at the right file are left exactly as written.
export function relinkNote(content: string, oldPath: string, newPath: string, moved: (p: string) => string): string {
	const newDir = dirOf(newPath);
	return mapLinks(content, dirOf(oldPath), (link) => {
		const now = moved(link.target);
		if (resolveLink(newDir, link.path) === now) return null;
		return link.rewrite(relativeTo(newDir, now));
	});
}
