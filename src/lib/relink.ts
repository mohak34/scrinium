// Relative markdown links ([text](url), ![alt](url)) point at vault files by
// path from the note's folder, so moving a note, or a file it links to,
// breaks them. relinkNote rewrites them to keep pointing at the same files.
// Shared by the notes route (on every rename or move) and the editor (the
// open note), so both produce the same text.

const LINK = /(!?\[[^\]\n]*\]\()(<[^>\n]*>|[^\s)]+)((?:\s+"[^"\n]*")?\))/g;
const FENCE = /^ {0,3}(```|~~~)/;

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
	// Rebuild the link around a new url path; keeps the ?query/#anchor,
	// angle brackets and percent-encoding of the original.
	rewrite(path: string): string;
}

// Calls fn for each relative link outside code (fences and inline spans);
// fn returns the new link text or null to keep it.
function mapLinks(content: string, dir: string, fn: (link: Link) => string | null): string {
	let fenced = false;
	return content
		.split('\n')
		.map((line) => {
			if (FENCE.test(line)) {
				fenced = !fenced;
				return line;
			}
			if (fenced) return line;
			// Odd parts are inline code spans, left alone.
			return line
				.split(/(`+[^`]*`+)/)
				.map((part, i) => (i % 2 ? part : relinkPart(part)))
				.join('');
		})
		.join('\n');

	function relinkPart(part: string): string {
		return part.replace(LINK, (m: string, open: string, raw: string, close: string) => {
			const angle = raw.startsWith('<');
			const url = angle ? raw.slice(1, -1) : raw;
			const cut = url.search(/[?#]/);
			const [pathPart, suffix] = cut < 0 ? [url, ''] : [url.slice(0, cut), url.slice(cut)];
			const path = decode(pathPart);
			const target = resolveLink(dir, path);
			if (target === null) return m;
			const encoded = !angle && path !== pathPart;
			const out = fn({
				path,
				target,
				rewrite(next) {
					if (encoded) return `${open}${encodeURI(next)}${suffix}${close}`;
					const url = next + suffix;
					return angle || /[\s()<>]/.test(url) ? `${open}<${url}>${close}` : `${open}${url}${close}`;
				}
			});
			return out ?? m;
		});
	}
}

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

// Every vault path the note's relative links point at.
export function linkTargets(content: string, notePath: string): string[] {
	const out: string[] = [];
	mapLinks(content, dirOf(notePath), (link) => (out.push(link.target), null));
	return out;
}
