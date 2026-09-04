/**
 * Note -> printable HTML for the /print route (and later, HTML download).
 *
 * Order matters, same contract as the editor:
 *   1. Display math (```math fences + own-line $$) via findMathBlockRanges,
 *      rendered with KaTeX display mode and stashed as tokens.
 *   2. Remaining fenced code via the Lezer tree, rendered as plain <pre>.
 *   3. Inline code spans via the tree.
 *   4. Inline `$...$` with the editor's guards (trimmed, no edge space,
 *      must contain a letter/backslash so `$5` stays text).
 *   5. markdown-it over the remainder, then token restore.
 *
 * Block-level extractions expand to full lines wrapped in blank lines so
 * markdown-it keeps each token in its own paragraph for clean restore.
 */

import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdownLanguage } from '$lib/editor/markdownSetup';
import { findMathBlockRanges } from '$lib/editor/mathRanges';
import {
	calloutChevronSvg,
	calloutIconSvg,
	canonicalCalloutType,
	defaultCalloutTitle
} from '$lib/editor/callouts';
import { findWikilinksInText, wikilinkDisplay } from '$lib/editor/wikilinks';
import { findTagsInText } from '$lib/editor/tags';
import { resolveAssetUrl } from '$lib/editor/livePreview';

const parser = new MarkdownIt({ html: false, linkify: true, breaks: true });

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function katexBlock(source: string): string {
	try {
		return `<div class="print-math">${katex.renderToString(source, { throwOnError: false, displayMode: true })}</div>`;
	} catch {
		return `<pre class="print-code"><code>${esc(source)}</code></pre>`;
	}
}

function katexInline(source: string): string {
	try {
		return `<span class="print-math-inline">${katex.renderToString(source, { throwOnError: false, displayMode: false })}</span>`;
	} catch {
		return `<code class="print-inline-code">${esc(`$${source}$`)}</code>`;
	}
}

/**
 * Rewrite markdown-it blockquotes whose first paragraph is a `[!type]`
 * marker into Obsidian-style callout divs. Runs after token restore so
 * math/code inside the body keep their rendered HTML for free.
 *
 * Two shapes: marker alone in its paragraph (blank line after the header),
 * or marker sharing one paragraph with the body (`breaks` joins the `>`
 * lines with <br>). Display `$$` inside the body renders via KaTeX here -
 * the editor/math finder only sees own-line fences, so `> $$` never
 * becomes a block range upstream.
 */
function renderCalloutBody(body: string): string {
	return body.replace(/\$\$([\s\S]*?)\$\$/g, (whole, src: string) => {
		const clean = src.replace(/<br\s*\/?>/gi, '\n').trim();
		if (!clean) return whole;
		return katexBlock(clean);
	});
}

function renderCallouts(html: string): string {
	return html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (whole, inner: string) => {
		const m = /^\s*<p>\[!([\w-]+)\]\s*([-+]?)\s*([\s\S]*?)<\/p>/i.exec(inner);
		if (!m) return whole;
		const kind = canonicalCalloutType(m[1]);
		const fold = m[2];
		const parts = m[3].split(/<br\s*\/?>/i);
		const title = parts[0].trim() || esc(defaultCalloutTitle(m[1]));
		let body = inner.slice(m[0].length);
		if (parts.length > 1) {
			const firstBody = parts.slice(1).join(' ').trim();
			if (firstBody) body = `<p>${firstBody}</p>` + body;
		}
		body = renderCalloutBody(body);
		const chev = fold ? calloutChevronSvg(fold !== '-') : '';
		return (
			`<div class="callout callout-${kind}">` +
			`<div class="callout-title">${calloutIconSvg(kind)}` +
			`<span>${title}</span>${chev}</div>` +
			(body.trim() ? `<div class="callout-body">${body}</div>` : '') +
			`</div>`
		);
	});
}

export function renderNoteToHtml(src: string, notePath: string): string {
	const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : null;
	const state = EditorState.create({ doc: src, extensions: [markdownLanguage()] });
	const chunks: string[] = [];
	const stash = (html: string): string => {
		chunks.push(html);
		return `SCRINIUMPRINT${chunks.length - 1}X`;
	};

	// Expand a range to whole lines so the token stands alone in the doc.
	const fullLines = (from: number, to: number): [number, number] => [
		state.doc.lineAt(from).from,
		state.doc.lineAt(Math.max(from, to - 1)).to
	];

	interface Span {
		from: number;
		to: number;
		html: string;
		block: boolean;
	}
	const spans: Span[] = [];

	// 1. Display math first so $$ never spans code.
	for (const r of findMathBlockRanges(state)) {
		const [from, to] = fullLines(r.from, r.to);
		spans.push({ from, to, html: katexBlock(r.source), block: true });
	}

	// 2 + 3. Fenced code (non-math) and inline code from the tree.
	const claimed = (from: number, to: number) =>
		spans.some((s) => from <= s.to && s.from <= to);
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name === 'FencedCode') {
				if (claimed(node.from, node.to)) return false;
				const info = node.node.getChild('CodeInfo');
				const lang = info ? state.doc.sliceString(info.from, info.to).trim() : '';
				if (lang === 'math') return false;
				const text = node.node.getChild('CodeText');
				const code = text ? state.doc.sliceString(text.from, text.to).replace(/\n$/, '') : '';
				const [from, to] = fullLines(node.from, node.to);
				spans.push({
					from,
					to,
					html:
						`<pre class="print-code">` +
						(lang ? `<div class="print-code-lang">${esc(lang)}</div>` : '') +
						`<code>${esc(code)}</code></pre>`,
					block: true
				});
				return false;
			}
			if (node.name === 'InlineCode') {
				if (claimed(node.from, node.to)) return;
				spans.push({
					from: node.from,
					to: node.to,
					html: `<code class="print-inline-code">${esc(state.doc.sliceString(node.from, node.to).replace(/^`+|`+$/g, ''))}</code>`,
					block: false
				});
			}
		}
	});

	// Splice back to front so earlier indices stay valid. Block spans get
	// blank lines around the token for a clean paragraph restore.
	let text = src;
	for (const s of [...spans].sort((a, b) => b.from - a.from)) {
		const token = stash(s.html);
		text =
			text.slice(0, s.from) +
			(s.block ? `\n\n${token}\n\n` : token) +
			text.slice(s.to);
	}

	// 4. Inline math on what's left (no code remains except raw fences of
	// unclosed blocks, which the tree guard below still skips).
	const inlineRe = /(?<!\$)\$(?!\$)([^$\n]{1,200}?)(?<!\\)\$(?!\$)/g;
	const liveState = EditorState.create({ doc: text, extensions: [markdownLanguage()] });
	const inlineSpans: Span[] = [];
	let m: RegExpExecArray | null;
	inlineRe.lastIndex = 0;
	while ((m = inlineRe.exec(text)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		const content = m[1];
		if (!content.trim() || /^\s|\s$/.test(content)) {
			inlineRe.lastIndex = start + 1;
			continue;
		}
		if (!/[A-Za-z\\]/.test(content)) {
			inlineRe.lastIndex = start + 1;
			continue;
		}
		const inner = syntaxTree(liveState).resolveInner(Math.min(start, text.length), 0);
		let cur: typeof inner | null = inner;
		let inCode = false;
		while (cur) {
			if (['CodeText', 'CodeMark', 'CodeInfo', 'InlineCode', 'FencedCode', 'CodeBlock'].includes(cur.name)) {
				inCode = true;
				break;
			}
			cur = cur.parent;
		}
		if (inCode) {
			inlineRe.lastIndex = start + 1;
			continue;
		}
		inlineSpans.push({ from: start, to: end, html: katexInline(content), block: false });
	}
	for (const s of inlineSpans.sort((a, b) => b.from - a.from)) {
		const token = stash(s.html);
		text = text.slice(0, s.from) + token + text.slice(s.to);
	}

	// 4b. Wikilinks after math+code so those claim first (Iverson `$[[P]]$`,
	// code spans). Stashed like everything else for a clean restore.
	const wikiState = EditorState.create({ doc: text, extensions: [markdownLanguage()] });
	const wikiSpans: Span[] = [];
	for (const w of findWikilinksInText(text)) {
		if (claimed(w.from, w.to)) {
			continue;
		}
		const inner = syntaxTree(wikiState).resolveInner(Math.min(w.from, text.length), 0);
		let cur: typeof inner | null = inner;
		let inCode = false;
		while (cur) {
			if (['CodeText', 'CodeMark', 'CodeInfo', 'InlineCode', 'FencedCode', 'CodeBlock'].includes(cur.name)) {
				inCode = true;
				break;
			}
			cur = cur.parent;
		}
		if (inCode) continue;
		wikiSpans.push({
			from: w.from,
			to: w.to,
			html: `<span class="print-wikilink">${parser.renderInline(wikilinkDisplay(w))}</span>`,
			block: false
		});
	}
	for (const s of wikiSpans.sort((a, b) => b.from - a.from)) {
		const token = stash(s.html);
		text = text.slice(0, s.from) + token + text.slice(s.to);
	}

	// 4b. Tags: same stash trick, same code guard. Tag bodies are
	// grammar-safe (letters/digits/`_`/`-`/`/`), so no escaping needed.
	const tagState = EditorState.create({ doc: text, extensions: [markdownLanguage()] });
	const tagSpans: Span[] = [];
	for (const t of findTagsInText(text)) {
		if (claimed(t.from, t.to)) {
			continue;
		}
		const inner = syntaxTree(tagState).resolveInner(Math.min(t.from, text.length), 0);
		let cur: typeof inner | null = inner;
		let inCode = false;
		while (cur) {
			if (['CodeText', 'CodeMark', 'CodeInfo', 'InlineCode', 'FencedCode', 'CodeBlock'].includes(cur.name)) {
				inCode = true;
				break;
			}
			cur = cur.parent;
		}
		if (inCode) continue;
		tagSpans.push({
			from: t.from,
			to: t.to,
			html: `<span class="print-tag">#${t.name}</span>`,
			block: false
		});
	}
	for (const s of tagSpans.sort((a, b) => b.from - a.from)) {
		const token = stash(s.html);
		text = text.slice(0, s.from) + token + text.slice(s.to);
	}

	// 5. Markdown over the remainder, then restore (tolerating <p> wrap).
	let html = parser.render(text);
	chunks.forEach((chunk, i) => {
		const token = `SCRINIUMPRINT${i}X`;
		html = html.split(`<p>${token}</p>`).join(chunk).split(token).join(chunk);
	});
	// 6. Relative image URLs resolve against the note's folder (same rule as
	// the editor) - otherwise they 404 against /print and only alt shows.
	html = html.replace(/<img([^>]*?)src="([^"]*)"/g, (m, rest, url) => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/')) return m;
		const resolved = resolveAssetUrl(url, noteDir);
		return resolved ? `<img${rest}src="${resolved}"` : m;
	});
	return renderCallouts(html);
}
