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
import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';

// Full-preview mode: when on, EVERY line renders (marks hidden, bullets shown)
// regardless of where the cursor is. Entered with Escape, exited by clicking
// back into the editor. The boolean is mirrored into the plugin via a StateEffect
// so the decoration set is rebuilt when it flips.
let previewOn = false;
export const previewModeEffect = StateEffect.define<boolean>();

export function isPreviewMode() {
	return previewOn;
}

// Given a document position, find the link URL that position sits on - the
// text of a `URL` node directly inside a `Link`/`Autolink`, or a bare top-level
// `URL` (GFM auto-link). Returns null when the position is not on a link.
export function urlAtPos(view: EditorView, pos: number): string | null {
	const node = syntaxTree(view.state).resolveInner(pos, -1);
	let cur = node;
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

function isLineActive(view: EditorView, from: number, to: number): boolean {
	if (previewOn) return false;
	const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
	const startLine = view.state.doc.lineAt(from).number;
	const endLine = view.state.doc.lineAt(to).number;
	return cursorLine >= startLine && cursorLine <= endLine;
}

function buildDecorations(view: EditorView): DecorationSet {
	const pending: PendingDecoration[] = [];
	const tree = syntaxTree(view.state);

	for (const { from, to } of view.visibleRanges) {
		tree.iterate({
			from,
			to,
			enter: (node) => {
				const active = isLineActive(view, node.from, node.to);

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
				if (node.name === 'ListMark' && !active && /^[-*+]$/.test(view.state.doc.sliceString(node.from, node.to))) {
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.replace({ widget: new BulletWidget() })
					});
				}

				if (node.name === 'TaskMarker') {
					const text = view.state.doc.sliceString(node.from, node.to);
					const checked = /\[[xX]\]/.test(text);
					pending.push({
						from: node.from,
						to: node.to,
						deco: Decoration.replace({ widget: new CheckboxWidget(checked, node.from) })
					});
				}
			}
		});
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
				update.selectionSet ||
				update.viewportChanged ||
				update.transactions.some((tr) => tr.effects.some((e) => e.is(previewModeEffect)))
			) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{
		decorations: (v) => v.decorations
	}
);
