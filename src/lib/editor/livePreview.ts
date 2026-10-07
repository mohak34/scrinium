/**
 * Obsidian-style "live preview" for CodeMirror 6.
 *
 * The idea: the document is always plain markdown text. On every edit or
 * cursor move we re-walk the syntax tree (from @lezer/markdown, via
 * @codemirror/lang-markdown) and decide, node by node, whether to:
 *   - style it in place (Decoration.mark)      e.g. bigger text for a heading
 *   - hide it entirely (Decoration.replace)    e.g. the "**" around bold text
 *   - swap it for a real widget (Decoration.widget) e.g. a clickable checkbox
 *
 * A hideable mark only gets hidden if the cursor is NOT currently on that
 * line. Move your cursor onto a heading line and the "#" reappears so you
 * can edit it; move away and it's gone again. That's the entire trick -
 * this file is intentionally small so you can see all of it at once.
 *
 * This is a working starting point covering the common cases (headings,
 * bold, italic, inline code, links, task checkboxes) - NOT a pixel-perfect
 * clone of Obsidian's renderer. For a more battle-tested version of this
 * same pattern, see:
 *   - github.com/segphault/codemirror-rich-markdoc  (the original reference)
 *   - github.com/blueberrycongee/codemirror-live-markdown (modular, more elements)
 */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { findMathBlockRanges, inlineMathRegex } from './mathRanges';
import { parseFrontmatter } from './frontmatter';
import { CALLOUT_ICONS, defaultCalloutTitle, findCallouts, quoteBoxLines } from './callouts';
import {
	findWikilinksInText,
	resolveWikilink,
	wikilinkDisplay,
	wikilinkFilename,
	type Wikilink
} from './wikilinks';
import { findTagsInText } from './tags';
import { createNote, flushSave, openTab } from '$lib/stores/vault';

// Full-preview mode: when on, EVERY line renders (marks hidden, bullets shown)
// regardless of where the cursor is. Entered with Escape, exited by clicking
// back into the editor. The boolean is mirrored into the plugin via a StateEffect
// so the decoration set is rebuilt when it flips.
let previewOn = false;
export const previewModeEffect = StateEffect.define<boolean>();

// The folder of the note being edited, used to resolve relative image URLs in
// the markdown (e.g. "attachments/foo.png" from a note in a subfolder). Kept in
// a StateField so the decoration set rebuilds when the note changes.
export const noteDirEffect = StateEffect.define<string | null>();
export const noteDirField = StateField.define<string | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(noteDirEffect)) return e.value;
		}
		return value;
	}
});

// Vault-wide link context for wikilinks: flat `.md` paths plus the open
// note (creation folder for unresolved targets). Mirrored from the vault
// store by CodeEditor; the decoration set rebuilds when it flips.
export interface WikiCtx {
	notes: string[];
	current: string | null;
}
export const wikiCtxEffect = StateEffect.define<WikiCtx>();
export const wikiCtxField = StateField.define<WikiCtx>({
	create: () => ({ notes: [], current: null }),
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(wikiCtxEffect)) return e.value;
		}
		return value;
	}
});

// Vault-wide tag list for `#` completion. Mirrored from /api/tags by
// CodeEditor when the tree changes; plain strings, no resolution needed.
export const tagCtxEffect = StateEffect.define<string[]>();
export const tagCtxField = StateField.define<string[]>({
	create: () => [],
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(tagCtxEffect)) return e.value;
		}
		return value;
	}
});

export function isPreviewMode() {
	return previewOn;
}

// Given a document position, find the link URL that position sits on - the
// text of a `URL` node directly inside a `Link`/`Autolink`, or a bare top-level
// `URL` (GFM auto-link). Returns null when the position is not on a link.
export function urlAtPos(view: EditorView, pos: number): string | null {
	const node = syntaxTree(view.state).resolveInner(pos, -1);
	let cur: typeof node | null = node;
	while (cur && !['Link', 'Autolink', 'URL'].includes(cur.name)) cur = cur.parent;
	if (!cur) return null;
	if (cur.name === 'URL') return view.state.sliceDoc(cur.from, cur.to);
	const cursor = cur.cursor();
	if (cursor.firstChild()) {
		do {
			if (cursor.name === 'URL') return view.state.sliceDoc(cursor.from, cursor.to);
		} while (cursor.nextSibling());
	}
	return null;
}

export function setPreviewMode(view: EditorView, on: boolean) {
	if (previewOn === on) return;
	previewOn = on;
	view.dispatch({ effects: previewModeEffect.of(on) });
}

// CodeMirror reuses an equal widget's DOM after edits shift the line, so
// the click reads its position from the DOM at click time, never from a
// position captured at build time.
class CheckboxWidget extends WidgetType {
	constructor(readonly checked: boolean) {
		super();
	}
	eq(other: CheckboxWidget) {
		return other.checked === this.checked;
	}
	toDOM(view: EditorView) {
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.checked = this.checked;
		box.className = 'cm-task-checkbox';
		box.onmousedown = (e) => {
			e.preventDefault();
			const pos = view.posAtDOM(box);
			const cur = view.state.sliceDoc(pos, pos + 3);
			if (!/^\[[ xX]\]$/.test(cur)) return;
			view.dispatch({
				changes: { from: pos, to: pos + 3, insert: cur === '[ ]' ? '[x]' : '[ ]' }
			});
		};
		return box;
	}
	ignoreEvent() {
		return true;
	}
}

// A `[[wikilink]]` rendered as a clickable pill when the cursor is off
// the line. Click navigates; clicking an unresolved target creates the
// note first (same folder as the open note, vault root otherwise).
class WikilinkWidget extends WidgetType {
	constructor(
		readonly target: string,
		readonly display: string
	) {
		super();
	}
	eq(other: WikilinkWidget) {
		return other.target === this.target && other.display === this.display;
	}
	toDOM(view: EditorView) {
		const span = document.createElement('span');
		const resolved = resolveWikilink(this.target, view.state.field(wikiCtxField, false)?.notes ?? []);
		span.className = resolved ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-unresolved';
		span.textContent = this.display;
		span.onmousedown = (e) => {
			e.preventDefault();
			const notes = view.state.field(wikiCtxField, false)?.notes ?? [];
			const current = view.state.field(wikiCtxField, false)?.current ?? null;
			const path = resolveWikilink(this.target, notes);
			if (path) {
				void flushSave().then(() => openTab(path));
				return;
			}
			const name = wikilinkFilename(this.target);
			if (!name) return;
			const dir = current?.includes('/') ? current.slice(0, current.lastIndexOf('/')) : null;
			const full = dir ? `${dir}/${name}` : name;
			void (async () => {
				try {
					await flushSave();
					await createNote(full);
					openTab(full);
				} catch {
					// creation failed - leave the raw link alone
				}
			})();
		};
		return span;
	}
	ignoreEvent() {
		return true;
	}
}

class BulletWidget extends WidgetType {
	toDOM() {
		const span = document.createElement('span');
		span.className = 'cm-bullet';
		span.textContent = '•';
		return span;
	}
	eq(other: BulletWidget) {
		return true;
	}
	ignoreEvent() {
		return true;
	}
}

// Callout header marker: replaces the raw `[!note]-` text (cursor off the
// line) with the type icon, an optional fold chevron, and the default title
// when the author left the title empty. The written title itself stays as
// plain text so it remains editable via the line-active reveal.
class CalloutHeaderWidget extends WidgetType {
	constructor(
		readonly icon: string,
		readonly fold: '' | '-' | '+',
		readonly fallbackTitle: string | null
	) {
		super();
	}
	eq(other: CalloutHeaderWidget) {
		return (
			other.icon === this.icon &&
			other.fold === this.fold &&
			other.fallbackTitle === this.fallbackTitle
		);
	}
	toDOM() {
		const span = document.createElement('span');
		span.className = 'cm-callout-marker';
		const icon = document.createElement('span');
		icon.className = 'material-symbols-outlined cm-callout-icon';
		icon.textContent = this.icon;
		span.appendChild(icon);
		if (this.fold) {
			const chev = document.createElement('span');
			chev.className = 'material-symbols-outlined cm-callout-fold';
			chev.textContent = 'expand_more';
			span.appendChild(chev);
		}
		if (this.fallbackTitle) {
			const t = document.createElement('span');
			t.className = 'cm-callout-default-title';
			t.textContent = this.fallbackTitle;
			span.appendChild(t);
		}
		return span;
	}
	ignoreEvent() {
		return true;
	}
}

// Turn a markdown image reference into a browser-loadable URL. Absolute
// (http(s)/data) URLs pass through; anything else is resolved against the
// folder of the note being edited and served through the auth-gated asset API.
// Turn a markdown image reference into a browser-loadable URL. Shared with
// the print renderer (renderNote.ts) so pasted images resolve identically.
export function resolveAssetUrl(url: string, noteDir: string | null): string | null {
	const clean = url.trim();
	if (!clean) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('/')) return clean;
	const joined = noteDir ? `${noteDir}/${clean}` : clean;
	const parts: string[] = [];
	for (const seg of joined.split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..') {
			parts.pop();
			continue;
		}
		parts.push(seg);
	}
	if (!parts.length) return null;
	return '/api/assets/' + parts.map(encodeURIComponent).join('/');
}

class ImageWidget extends WidgetType {
	constructor(
		readonly url: string,
		readonly alt: string,
		readonly noteDir: string | null
	) {
		super();
	}
	eq(other: ImageWidget) {
		return other.url === this.url && other.alt === this.alt && other.noteDir === this.noteDir;
	}
	toDOM() {
		const img = document.createElement('img');
		const src = resolveAssetUrl(this.url, this.noteDir);
		img.src = src ?? '';
		img.alt = this.alt;
		img.className = 'cm-image';
		img.loading = 'lazy';
		return img;
	}
	ignoreEvent() {
		return true;
	}
}

// Inline `$...$` only (single line). Block math lives in mathBlock.ts as a
// StateField so multi-line replaces do not corrupt the ViewPlugin layout.
const katexCache = new Map<string, string>();
function renderInlineMath(content: string): string {
	const key = content;
	const hit = katexCache.get(key);
	if (hit !== undefined) return hit;
	try {
		const html = katex.renderToString(content, { throwOnError: false, displayMode: false });
		katexCache.set(key, html);
		return html;
	} catch {
		return `$${content}$`;
	}
}

class InlineMathWidget extends WidgetType {
	constructor(readonly content: string) {
		super();
	}
	eq(other: InlineMathWidget) {
		return other.content === this.content;
	}
	toDOM() {
		const span = document.createElement('span');
		span.className = 'cm-math-inline';
		span.innerHTML = renderInlineMath(this.content);
		return span;
	}
	ignoreEvent() {
		return true;
	}
}

const HEADING_CLASS: Record<string, string> = {
	ATXHeading1: 'cm-heading-1',
	ATXHeading2: 'cm-heading-2',
	ATXHeading3: 'cm-heading-3',
	ATXHeading4: 'cm-heading-4',
	ATXHeading5: 'cm-heading-5',
	ATXHeading6: 'cm-heading-6'
};

// Node names (from @lezer/markdown) whose text should be hidden entirely
// unless the cursor is on that line - i.e. the raw formatting characters.
const HIDEABLE_MARKS = new Set([
	'HeaderMark', // the "#" of a heading
	'EmphasisMark', // the "*"/"_" around italic or bold text
	'CodeMark', // the backtick(s) around inline code
	'CodeInfo', // the language name in ```python
	'LinkMark', // the "[", "]", "(", ")" of a link
	'URL' // the URL text itself inside [text](url) - never a bare link
]);

interface PendingDecoration {
	from: number;
	to: number;
	deco: Decoration;
}

function isLineActive(view: EditorView, from: number, to: number): boolean {
	if (previewOn) return false;
	const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
	const startLine = view.state.doc.lineAt(from).number;
	const endLine = view.state.doc.lineAt(to).number;
	return cursorLine >= startLine && cursorLine <= endLine;
}

// True when pos sits inside any code node, so `$` in fences, inline code
// or info strings never renders as math.
function isInsideCode(view: EditorView, pos: number): boolean {
	const inner = syntaxTree(view.state).resolveInner(Math.min(pos, view.state.doc.length), 0);
	let cur: typeof inner | null = inner;
	while (cur) {
		if (
			cur.name === 'CodeText' ||
			cur.name === 'CodeMark' ||
			cur.name === 'CodeInfo' ||
			cur.name === 'InlineCode' ||
			cur.name === 'FencedCode' ||
			cur.name === 'CodeBlock'
		)
			return true;
		cur = cur.parent;
	}
	return false;
}

function buildDecorations(view: EditorView): DecorationSet {
	const pending: PendingDecoration[] = [];
	const tree = syntaxTree(view.state);

	// Callouts first: the `[!note]` header parses as Link/LinkMark nodes, so
	// the walk below must skip those inner decorations where our header
	// widget replaces the whole marker (overlapping replaces corrupt the
	// RangeSetBuilder).
	const callouts = findCallouts(view.state);
	const inCalloutHeader = (from: number, to: number): boolean =>
		callouts.some((c) => from >= c.headerFrom && to <= c.headerTo);

	// Wikilinks via text scan (the `[[]]` shape has no dedicated Lezer
	// node). Ranges are computed up front so the tree walk can skip the
	// inner `[x]` Link decorations where the widget replaces the whole
	// `[[...]]` - same overlap rule as callout headers.
	const docText = view.state.doc.toString();
	const blockRanges = findMathBlockRanges(view.state);
	// Frontmatter is raw YAML, never pretty markdown: nothing inside the
	// block is styled, hidden or swapped (its closing `---` parses as a
	// setext HeaderMark, YAML `-` lists as bullets, `#` comments as ATX).
	const fmEnd = parseFrontmatter(docText)?.bodyStart ?? 0;
	const inFm = (from: number): boolean => fmEnd > 0 && from < fmEnd;
	const wikilinks: Wikilink[] = findWikilinksInText(docText).filter((w) => {
		if (inFm(w.from)) return false;
		if (blockRanges.some((r) => w.from <= r.to && r.from <= w.to)) return false;
		if (isInsideCode(view, w.from) || isInsideCode(view, Math.max(w.from, w.to - 1)))
			return false;
		return true;
	});
	const inWikilink = (from: number, to: number): boolean =>
		wikilinks.some((w) => from >= w.from && to <= w.to);

	for (const { from, to } of view.visibleRanges) {
		tree.iterate({
			from,
			to,
			enter: (node) => {
				const active = isLineActive(view, node.from, node.to);

				const headingClass = HEADING_CLASS[node.name];
				if (headingClass && !inFm(node.from)) {
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.mark({ class: headingClass })
					});
				}

				if (node.name === 'StrongEmphasis') {
					pending.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-strong' }) });
				}
				if (node.name === 'Emphasis') {
					pending.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-em' }) });
				}
				if (node.name === 'InlineCode') {
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.mark({ class: 'cm-inline-code' })
					});
				}
				if (node.name === 'Link') {
					if (!inCalloutHeader(node.from, node.to) && !inWikilink(node.from, node.to)) {
						pending.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-link' }) });
					}
				}

				// Fenced code: hide fences + lang when cursor is off the whole block,
				// and style the content as a single block via line backgrounds.
				// ```math blocks are owned by mathBlock.ts, skip them here so
				// code and math never claim the same range.
				if (node.name === 'FencedCode') {
					const infoNode = node.node.getChild('CodeInfo');
					const lang = infoNode ? view.state.sliceDoc(infoNode.from, infoNode.to).trim() : '';
					if (lang === 'math') return false;
					const isActive = isLineActive(view, node.from, node.to);
					if (!isActive) {
						const textNode = node.node.getChild('CodeText');
						if (textNode) {
							pending.push({
								from: textNode.from,
								to: textNode.to,
								deco: Decoration.mark({ class: 'cm-codeblock-content' })
							});
							let pos = textNode.from;
							const end = textNode.to;
							while (pos <= end) {
								const line = view.state.doc.lineAt(pos);
								pending.push({
									from: line.from,
									to: line.from,
									deco: Decoration.line({ class: 'cm-codeblock-line' })
								});
								if (line.to >= end) break;
								pos = line.to + 1;
							}
						}
					}
				}
				if (node.name === 'CodeBlock' && !active) {
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.mark({ class: 'cm-codeblock-content' })
					});
					let pos = node.from;
					const end = node.to;
					while (pos <= end) {
						const line = view.state.doc.lineAt(pos);
						pending.push({
							from: line.from,
							to: line.from,
							deco: Decoration.line({ class: 'cm-codeblock-line' })
						});
						if (line.to >= end) break;
						pos = line.to + 1;
					}
				}

				if (HIDEABLE_MARKS.has(node.name) && !inFm(node.from)) {
					// The callout header widget owns the whole `[!type]-`
					// marker when the line is pretty; inner LinkMark/URL
					// hides would overlap that replace. Same for wikilink
					// widgets over the inner `[x]` LinkMarks.
					// A bare URL or <autolink> is the link text itself: hiding
					// it would blank the link. Only [text](url) hides its URL.
					const linkPart = node.name === 'LinkMark' || node.name === 'URL';
					const parent = node.node.parent?.name;
					if (
						(linkPart && (inCalloutHeader(node.from, node.to) || inWikilink(node.from, node.to))) ||
						(node.name === 'URL' && parent !== 'Link' && parent !== 'Image')
					) {
						// fall through to nothing (skip)
					} else {
						let shouldHide = !active;
						if (node.name === 'CodeMark' || node.name === 'CodeInfo') {
							const parent = node.node.parent?.name;
							if (parent === 'FencedCode' || parent === 'CodeBlock') {
								// Math fences belong to mathBlock.ts, never hide here.
								if (parent === 'FencedCode') {
									const info = node.node.parent!.getChild('CodeInfo');
									if (info && view.state.sliceDoc(info.from, info.to).trim() === 'math')
										return;
								}
								shouldHide = !isLineActive(view, node.node.parent!.from, node.node.parent!.to);
							}
						}
						if (shouldHide) {
							pending.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
						}
					}
				}

				// Turn a bare bullet marker ("-", "*", "+") into a "•" dot while
				// the cursor is elsewhere. Ordered-list markers ("1.") are left
				// alone, hence the single-char check.
				if (node.name === 'ListMark' && !active && !inFm(node.from) && /^[-*+]$/.test(view.state.doc.sliceString(node.from, node.to))) {
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.replace({ widget: new BulletWidget() })
					});
				}

				// Render the task bracket as a clickable checkbox while the cursor
				// is elsewhere (and always in full preview). When the cursor is on
				// the task line, leave the raw "[ ]" text so it's editable and the
				// cursor can pass either side of it - mirroring how the bullet and
				// heading markers already behave.
				if (node.name === 'TaskMarker' && !active && !inFm(node.from)) {
					const text = view.state.doc.sliceString(node.from, node.to);
					const checked = /\[[xX]\]/.test(text);
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.replace({ widget: new CheckboxWidget(checked) })
					});
				}

				// Plain `>` quotes get the callout box treatment minus the
				// icon and title: line backgrounds form the box, `>` marks
				// hide off-line. A Blockquote owned by a callout is skipped
				// (the callout paints those lines), as is frontmatter.
				if (node.name === 'Blockquote') {
					const quoteLines = quoteBoxLines(view.state, node.from, node.to, callouts, fmEnd);
					if (quoteLines) {
						const firstLine = quoteLines[0];
						const lastLine = quoteLines[quoteLines.length - 1];
						for (const n of quoteLines) {
							const line = view.state.doc.line(n);
							pending.push({
								from: line.from,
								to: line.from,
								deco: Decoration.line({
									class: `cm-quote${n === firstLine ? ' cm-quote-first' : ''}${n === lastLine ? ' cm-quote-last' : ''}`
								})
							});
						}
					}
				}
				if (node.name === 'QuoteMark') {
					const markLine = view.state.doc.lineAt(node.from).number;
					const owned =
						inFm(node.from) || callouts.some((c) => markLine >= c.firstLine && markLine <= c.lastLine);
					if (!owned && !active) {
						pending.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
					}
				}

				// Render the whole image markdown as a real <img> while the cursor
				// is elsewhere (and always in full preview). Returning false stops
				// the walk from also decorating the inner LinkMark/URL nodes, which
				// would overlap this replacement and break the RangeSetBuilder.
				if (node.name === 'Image' && !active && !inFm(node.from)) {
					const urlNode = node.node.getChild('URL');
					// A plugin may not replace across a line break, and alt
					// text can wrap: leave a multi-line image as raw text.
					const oneLine = view.state.doc.lineAt(node.from).number === view.state.doc.lineAt(node.to).number;
					if (urlNode && oneLine) {
						const firstMark = node.node.getChild('LinkMark');
						const secondMark = firstMark?.nextSibling;
						const alt =
							firstMark && secondMark
								? view.state.sliceDoc(firstMark.to, secondMark.from)
								: '';
						pending.push({
							from: node.from,
							to: node.to,
							deco: Decoration.replace({
								widget: new ImageWidget(
									view.state.sliceDoc(urlNode.from, urlNode.to),
									alt,
									view.state.field(noteDirField, false) ?? null
								)
							})
						});
					}
					return false;
				}
			}
		});
	}

	// Callouts: box the whole quote via line decorations, hide the leading
	// `>` per line and swap the `[!type]-` marker for an icon widget - all
	// gated on the cursor being off that line, same contract as every other
	// hideable mark. Line backgrounds stay on while editing so the box never
	// collapses under the cursor.
	for (const c of callouts) {
		// A `>` line inside YAML is data, never a callout box.
		if (inFm(c.headerFrom)) continue;
		for (let n = c.firstLine; n <= c.lastLine; n++) {
			if (n < 1 || n > view.state.doc.lines) continue;
			const line = view.state.doc.line(n);
			const isFirst = n === c.firstLine;
			const isLast = n === c.lastLine;
			pending.push({
				from: line.from,
				to: line.from,
				deco: Decoration.line({
					class: `cm-callout cm-callout-${c.kind}${isFirst ? ' cm-callout-first' : ''}${isLast ? ' cm-callout-last' : ''}${isFirst ? '' : ' cm-callout-body'}`
				})
			});
			const lineActive = isLineActive(view, line.from, line.to);
			if (!lineActive) {
				const prefix = c.prefixes[n - c.firstLine];
				if (prefix && prefix.to > prefix.from) {
					pending.push({ from: prefix.from, to: prefix.to, deco: Decoration.replace({}) });
				}
				if (isFirst) {
					pending.push({
						from: c.headerFrom,
						to: c.headerTo,
						deco: Decoration.replace({
							widget: new CalloutHeaderWidget(
								CALLOUT_ICONS[c.kind],
								c.fold,
								c.title ? null : defaultCalloutTitle(c.raw)
							)
						})
					});
				}
			}
			if (isFirst && c.title) {
				pending.push({
					from: c.headerTo,
					to: line.to,
					deco: Decoration.mark({ class: 'cm-callout-title' })
				});
			}
		}
	}

	// Wikilinks: pretty pill off-line, raw text on-line. Same contract as
	// every other hideable mark. Resolution happens live in the widget so
	// newly created notes flip from unresolved without an edit.
	for (const w of wikilinks) {
		const active = isLineActive(view, w.from, Math.max(w.from, w.to - 1));
		if (active) {
			pending.push({ from: w.from, to: w.to, deco: Decoration.mark({ class: 'cm-wikilink-source' }) });
		} else {
			pending.push({
				from: w.from,
				to: w.to,
				deco: Decoration.replace({
					widget: new WikilinkWidget(w.target, wikilinkDisplay(w))
				})
			});
		}
	}

	// Tags: plain style marks, never hidden or swapped, so there is no
	// caret-crossing hazard and no active-line gating. Code, math blocks
	// and wikilinks are excluded like every other decoration.
	for (const t of findTagsInText(docText)) {
		if (blockRanges.some((r) => t.from <= r.to && r.from <= t.to)) continue;
		if (isInsideCode(view, t.from) || isInsideCode(view, Math.max(t.from, t.to - 1)))
			continue;
		if (inWikilink(t.from, t.to)) continue;
		pending.push({ from: t.from, to: t.to, deco: Decoration.mark({ class: 'cm-tag' }) });
	}

	// Inline math: single-line `$...$` only. Block math (```math fences and
	// own-line $$...$$) lives in mathBlock.ts as a StateField, because
	// multi-line replaces must not go through this ViewPlugin. Skip anything
	// inside code or inside a block-math range - an inline replace overlapping
	// a block replace corrupts the RangeSetBuilder.
	const inlineRegex = inlineMathRegex();
	let m: RegExpExecArray | null;
	while ((m = inlineRegex.exec(docText)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		const content = m[1];
		// Frontmatter values are YAML, never math.
		if (inFm(start)) {
			inlineRegex.lastIndex = start + 1;
			continue;
		}
		if (blockRanges.some((r) => start <= r.to && r.from <= end)) {
			inlineRegex.lastIndex = start + 1;
			continue;
		}
		if (isInsideCode(view, start) || isInsideCode(view, Math.max(start, end - 1))) {
			inlineRegex.lastIndex = start + 1;
			continue;
		}
		const active = isLineActive(view, start, Math.max(start, end - 1));
		if (active) {
			pending.push({ from: start, to: end, deco: Decoration.mark({ class: 'cm-math-source' }) });
		} else {
			pending.push({
				from: start,
				to: end,
				deco: Decoration.replace({ widget: new InlineMathWidget(content) })
			});
		}
	}

	// Sort by start position and startSide - required by RangeSetBuilder, and
	// simplest to just do once at the end rather than fight tree-walk ordering.
	pending.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);

	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to, deco } of pending) {
		builder.add(from, to, deco);
	}
	return builder.finish();
}

export const livePreview = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.transactions.some(
					(tr) =>
						tr.effects.some((e) => e.is(previewModeEffect)) ||
						tr.effects.some((e) => e.is(noteDirEffect)) ||
						tr.effects.some((e) => e.is(wikiCtxEffect))
				)
			) {
				this.decorations = buildDecorations(update.view);
				return;
			}
			// Every hide/reveal decision is line-based, so same-line selection
			// motion reuses the set instead of churning layout per keypress.
			if (update.selectionSet) {
				const a = update.startState.selection.main.head;
				const b = update.state.selection.main.head;
				if (update.startState.doc.lineAt(a).number !== update.state.doc.lineAt(b).number) {
					this.decorations = buildDecorations(update.view);
				}
			}
		}
	},
	{
		decorations: (v) => v.decorations
	}
);
