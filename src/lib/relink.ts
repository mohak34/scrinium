// A note links to other vault files two ways: relative markdown links
// ([text](url), ![alt](url), [ref]: url) by path from the note's folder, and
// [[wikilinks]] by name. Moving a note, or a file it links to, can break
// either. relinkNote rewrites them to keep pointing at the same files, and
// noteLinks lists where a note's links go (backlinks, review). Shared by the
// notes route (on every rename or move) and the editor (the open note), so
// both produce the same text. Links are found by the same Lezer markdown
// parser the editor uses, so code is never touched.

import { parser, GFM } from '@lezer/markdown';
import { decodeHTMLStrict } from 'entities/decode';
import { findWikilinksInText, wikiTargetFor, type Wikilink, type WikiResolver } from './editor/wikilinks';

// No HTML blocks: the renderer (markdown-it, html off) shows links inside them.
const markdown = parser.configure([GFM, { remove: ['HTMLBlock'] }]);
// Syntax nodes whose URL child is a link destination (not a bare autolink).
const LINK_NODES = new Set(['Link', 'Image', 'LinkReference']);
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode']);

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

// Markdown text as it renders: backslash escapes (`\(`) and character
// references (`&amp;`, `&apos;`, `&#40;`) undone in one pass, so an escaped
// `\&amp;` stays literal, like markdown-it's unescapeAll. Also used by the
// unused-files scan.
export function unescapeMarkdown(s: string): string {
	return s.replace(
		/\\([!-/:-@[-`{-~])|&(?:[a-z][a-z\d]{1,31}|#\d{1,7}|#x[\da-f]{1,6});/gi,
		(m, esc?: string) => esc ?? decodeHTMLStrict(m)
	);
}

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
	from: number;
	to: number;
	// The url's path as written (decoded), and the vault path it reaches.
	path: string;
	target: string;
	// The url rebuilt around a new path; keeps the ?query/#anchor and angle
	// brackets of the original.
	rewrite(path: string): string;
}

// One parse of a note: its relative link destinations and its wikilinks,
// both outside code.
function scan(content: string, dir: string): { links: Link[]; wikis: Wikilink[] } {
	const links: Link[] = [];
	const code: { from: number; to: number }[] = [];
	markdown.parse(content).iterate({
		enter(node) {
			if (CODE_NODES.has(node.name)) {
				code.push({ from: node.from, to: node.to });
				return false;
			}
			if (node.name !== 'URL' || !LINK_NODES.has(node.node.parent?.name ?? '')) return;
			const raw = content.slice(node.from, node.to);
			const angle = raw.startsWith('<');
			const url = angle ? raw.slice(1, -1) : raw;
			// The ?query/#anchor is kept as written; a "#" inside "&#40;" is not one.
			const cut = url.search(/\?|(?<!&)#/);
			const [pathPart, suffix] = cut < 0 ? [url, ''] : [url.slice(0, cut), url.slice(cut)];
			const path = decode(unescapeMarkdown(pathPart));
			const target = resolveLink(dir, path);
			if (target === null) return;
			links.push({
				from: node.from,
				to: node.to,
				path,
				target,
				rewrite(next) {
					// Percent-encode what would end the destination or read as an entity,
					// a query or a fragment; angle brackets already allow spaces and parens.
					const enc = next.replace(angle ? /[%&#?<>\n]/g : /[%&#?<>()\s\\]/g, (c) =>
						encodeURIComponent(c).replace('(', '%28').replace(')', '%29')
					);
					return angle ? `<${enc}${suffix}>` : enc + suffix;
				}
			});
		}
	});
	// Code ranges come out sorted and disjoint, wikilinks sorted: one sweep.
	let i = 0;
	const wikis = findWikilinksInText(content).filter((w) => {
		while (i < code.length && code[i].to <= w.from) i++;
		return !(i < code.length && code[i].from < w.to);
	});
	return { links, wikis };
}

function applyEdits(content: string, edits: { from: number; to: number; text: string }[]): string {
	let out = content;
	for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
	return out;
}

/**
 * Vault paths a note links to, by either kind of link, outside code.
 * `[[#heading]]` links to the note itself. Unresolved wikilinks are left
 * out; a markdown link counts whether or not its file exists.
 */
export function noteLinks(content: string, notePath: string, links: WikiResolver): Array<{ from: number; to: number; target: string }> {
	const { links: md, wikis } = scan(content, dirOf(notePath));
	const out: Array<{ from: number; to: number; target: string }> = md.map((l) => ({ from: l.from, to: l.to, target: l.target }));
	for (const w of wikis) {
		const target = w.target ? links.resolve(w.target) : notePath;
		if (target) out.push({ from: w.from, to: w.to, target });
	}
	return out.sort((a, b) => a.from - b.from);
}

// Maps a vault path through a rename of `from` (a file or folder) to `to`.
export function movedBy(from: string, to: string): (p: string) => string {
	return (p) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p);
}

// The note's text with links fixed after a move: the note itself went from
// oldPath to newPath (the same path when it did not move), and `moved` maps
// every vault path to where it is now. Wikilinks are fixed when `wiki`
// gives the vault's notes before and after the move: a link that resolved
// to a note before is pointed at the same note after, which also catches a
// moved note taking over another's bare name. Links that already point at
// the right file are left exactly as written.
export function relinkNote(
	content: string,
	oldPath: string,
	newPath: string,
	moved: (p: string) => string,
	wiki?: { before: WikiResolver; after: WikiResolver }
): string {
	const newDir = dirOf(newPath);
	const { links, wikis } = scan(content, dirOf(oldPath));
	const edits: { from: number; to: number; text: string }[] = [];
	for (const link of links) {
		const now = moved(link.target);
		if (resolveLink(newDir, link.path) !== now) edits.push({ from: link.from, to: link.to, text: link.rewrite(relativeTo(newDir, now)) });
	}
	for (const w of wiki ? wikis : []) {
		const was = w.target && wiki!.before.resolve(w.target);
		if (!was) continue;
		const now = moved(was);
		// Still right, unless it names a folder path that is gone.
		const path = w.target.includes('/');
		if (wiki!.after.resolve(w.target) === now && (!path || wiki!.after.exact(w.target))) continue;
		// Only the target is rewritten: heading, alias and spacing stay as typed.
		const inner = content.slice(w.from + 2, w.to - 2);
		const cut = inner.search(/[#|]/);
		const end = w.from + 2 + (cut < 0 ? inner.length : cut);
		edits.push({ from: w.from + 2, to: end, text: wikiTargetFor(now, wiki!.after, path) });
	}
	return edits.length ? applyEdits(content, edits) : content;
}
