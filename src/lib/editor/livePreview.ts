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
import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

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

class CheckboxWidget extends WidgetType {
	constructor(
		readonly checked: boolean,
		readonly pos: number
	) {
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
			const replacement = this.checked ? '[ ]' : '[x]';
			view.dispatch({
				changes: { from: this.pos, to: this.pos + 3, insert: replacement }
			});
		};
		return box;
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

// Turn a markdown image reference into a browser-loadable URL. Absolute
// (http(s)/data) URLs pass through; anything else is resolved against the
// folder of the note being edited and served through the auth-gated asset API.
function resolveAssetUrl(url: string, noteDir: string | null): string | null {
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
		return other.url === this.url;
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

// Obsidian-style callouts: a blockquote whose first line is "[!TYPE] title".
// Rendered as a styled box while the cursor is away from it; raw blockquote
// text (editable) when the cursor is on any of its lines.
const CALLOUTS: Record<string, string> = {
	note: 'i',
	tip: '✦',
	important: '!',
	warning: '⚠',
	caution: '✕'
};

const CALLOUT_RE = /^\s*>+\s*\[!\s*([a-z]+)\s*\]\s*(.*)$/i;

function parseCallout(
	state: EditorState,
	node: SyntaxNode
): { type: string; title: string; content: string } | null {
	const firstLine = state.doc.lineAt(node.from);
	const match = firstLine.text.match(CALLOUT_RE);
	if (!match) return null;
	const type = match[1].toLowerCase();
	if (!CALLOUTS[type]) return null;
	const title = match[2].trim() || type.charAt(0).toUpperCase() + type.slice(1);
	const start = firstLine.number;
	const end = state.doc.lineAt(node.to).number;
	const lines: string[] = [];
	for (let n = start + 1; n <= end; n++) {
		lines.push(state.doc.line(n).text.replace(/^\s*>+\s?/, ''));
	}
	return { type, title, content: lines.join('\n') };
}

class CalloutWidget extends WidgetType {
	constructor(
		readonly type: string,
		readonly title: string,
		readonly content: string
	) {
		super();
	}
	eq(other: CalloutWidget) {
		return (
			other.type === this.type &&
			other.title === this.title &&
			other.content === this.content
		);
	}
	toDOM() {
		const wrap = document.createElement('div');
		wrap.className = `cm-callout cm-callout-${this.type}`;
		const header = document.createElement('div');
		header.className = 'cm-callout-title';
		const icon = document.createElement('span');
		icon.className = 'cm-callout-icon';
		icon.textContent = CALLOUTS[this.type];
		header.append(icon, document.createTextNode(this.title));
		wrap.appendChild(header);
		if (this.content) {
			const body = document.createElement('div');
			body.className = 'cm-callout-content';
			body.textContent = this.content;
			wrap.appendChild(body);
		}
		return wrap;
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
	'LinkMark', // the "[", "]", "(", ")" of a link
	'URL' // the URL text itself inside [text](url)
]);

interface PendingDecoration {
	from: number;
	to: number;
	deco: Decoration;
}

function isLineActive(state: EditorState, from: number, to: number): boolean {
	if (previewOn) return false;
	const cursorLine = state.doc.lineAt(state.selection.main.head).number;
	const startLine = state.doc.lineAt(from).number;
	const endLine = state.doc.lineAt(to).number;
	return cursorLine >= startLine && cursorLine <= endLine;
}

function buildDecorations(state: EditorState): DecorationSet {
	const pending: PendingDecoration[] = [];
	const tree = syntaxTree(state);

	tree.iterate({
		from: 0,
		to: state.doc.length,
		enter: (node) => {
				const active = isLineActive(state, node.from, node.to);

				const headingClass = HEADING_CLASS[node.name];
				if (headingClass) {
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
					pending.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-link' }) });
				}

				if (HIDEABLE_MARKS.has(node.name) && !active) {
					pending.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
				}

				// Turn a bare bullet marker ("-", "*", "+") into a "•" dot while
				// the cursor is elsewhere. Ordered-list markers ("1.") are left
				// alone, hence the single-char check.
				if (node.name === 'ListMark' && !active && /^[-*+]$/.test(state.doc.sliceString(node.from, node.to))) {
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.replace({ widget: new BulletWidget() })
					});
				}

				if (node.name === 'TaskMarker') {
					const text = state.doc.sliceString(node.from, node.to);
					const checked = /\[[xX]\]/.test(text);
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.replace({ widget: new CheckboxWidget(checked, node.from) })
					});
				}

				// Render the whole image markdown as a real <img> while the cursor
				// is elsewhere (and always in full preview). Returning false stops
				// the walk from also decorating the inner LinkMark/URL nodes, which
				// would overlap this replacement and break the RangeSetBuilder.
				if (node.name === 'Image' && !active) {
					const urlNode = node.node.getChild('URL');
					if (urlNode) {
						const firstMark = node.node.getChild('LinkMark');
						const secondMark = firstMark?.nextSibling;
						const alt =
							firstMark && secondMark
								? state.sliceDoc(firstMark.to, secondMark.from)
								: '';
						pending.push({
							from: node.from,
							to: node.to,
							deco: Decoration.replace({
								widget: new ImageWidget(
									state.sliceDoc(urlNode.from, urlNode.to),
									alt,
									state.field(noteDirField, false) ?? null
								)
							})
						});
					}
					return false;
				}

				if (node.name === 'Blockquote') {
					const callout = parseCallout(state, node.node);
					if (callout && !active) {
						pending.push({
							from: node.from,
							to: node.to,
							deco: Decoration.replace({
								widget: new CalloutWidget(callout.type, callout.title, callout.content),
								block: true
							})
						});
						return false;
					}
				}
			}
		});

	// Sort by start position and startSide - required by RangeSetBuilder, and
	// simplest to just do once at the end rather than fight tree-walk ordering.
	pending.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);

	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to, deco } of pending) {
		builder.add(from, to, deco);
	}
	return builder.finish();
}

// The decoration set is provided through a StateField (not a ViewPlugin):
// CodeMirror only allows block-level decorations (like the multi-line callout
// box) from a state field, never from a dynamic plugin-provided set.
export const livePreview = StateField.define<DecorationSet>({
	create(state) {
		return buildDecorations(state);
	},
	update(value, tr) {
		if (
			tr.docChanged ||
			!tr.startState.selection.eq(tr.state.selection) ||
			tr.effects.some((e) => e.is(previewModeEffect)) ||
			tr.effects.some((e) => e.is(noteDirEffect))
		) {
			return buildDecorations(tr.state);
		}
		return value;
	},
	provide: (f) => EditorView.decorations.from(f)
});
