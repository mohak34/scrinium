/**
 * Display-math decorations as a StateField.
 *
 * Handles two block forms:
 *   1. ```math fenced blocks (found via the Lezer tree)
 *   2. Own-line $$...$$ blocks (strict: fences on their own lines, or a
 *      single-line $$...$$), found via regex with overlap guards.
 *
 * This must be a StateField (not part of the livePreview ViewPlugin)
 * because replacing whole lines changes vertical layout - CodeMirror
 * requires such decorations to be provided directly via
 * EditorView.decorations.from. The code path in livePreview.ts skips
 * ```math fences so the two never claim the same range.
 */

import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { fillMath } from './mathRender';
import { previewModeEffect, isPreviewMode } from './livePreview';
import { findMathBlockRanges } from './mathRanges';

class BlockMathWidget extends WidgetType {
	constructor(readonly content: string) {
		super();
	}
	eq(other: BlockMathWidget) {
		return other.content === this.content;
	}
	// Stable pre-measure height: without it every fresh widget reports
	// unknown height, and rapid arrow traversal past not-yet-drawn widgets
	// flaps the viewport so lines get visually skipped.
	get estimatedHeight(): number {
		return 40 + this.content.split('\n').length * 26;
	}
	toDOM(view: EditorView) {
		const div = document.createElement('div');
		div.className = 'cm-math-block';
		fillMath(div, view, this.content, true);
		return div;
	}
	ignoreEvent() {
		return true;
	}
}

function isRangeActive(state: EditorState, from: number, to: number): boolean {
	if (isPreviewMode()) return false;
	const cursorLine = state.doc.lineAt(state.selection.main.head).number;
	const startLine = state.doc.lineAt(from).number;
	const endLine = state.doc.lineAt(to).number;
	// One line of grace on each side: a replaced block hides its lines from
	// layout, so native Up/Down from further out can jump clean over it and
	// the cursor would never land inside to reveal source. Revealing when
	// adjacent means hidden lines never exist near the cursor and all arrow
	// motion stays native (symmetric both directions).
	return cursorLine >= startLine - 1 && cursorLine <= endLine + 1;
}

// The blocks isRangeActive reveals at the cursor, as "from,from,...":
// those meeting the cursor line or a line next to it, by binary search.
function activeBlocks(state: EditorState): string {
	if (isPreviewMode()) return '';
	const { doc } = state;
	const line = doc.lineAt(state.selection.main.head).number;
	const lo = doc.line(Math.max(1, line - 1)).from;
	const hi = doc.line(Math.min(doc.lines, line + 1)).to;
	const ranges = findMathBlockRanges(state);
	let a = 0;
	let b = ranges.length;
	while (a < b) {
		const mid = (a + b) >> 1;
		if (ranges[mid].to >= lo) b = mid;
		else a = mid + 1;
	}
	const out: number[] = [];
	for (let i = a; i < ranges.length && ranges[i].from <= hi; i++) out.push(ranges[i].from);
	return out.join();
}

function pushSourceLines(
	out: { from: number; to: number; deco: Decoration }[],
	state: EditorState,
	from: number,
	to: number
) {
	let pos = from;
	const end = Math.max(from, to - 1);
	while (pos <= end) {
		const line = state.doc.lineAt(pos);
		out.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-math-source-block' }) });
		if (line.to >= end) break;
		pos = line.to + 1;
	}
}

function buildBlockMathDecorations(state: EditorState): DecorationSet {
	const pending: { from: number; to: number; deco: Decoration }[] = [];
	for (const r of findMathBlockRanges(state)) {
		if (isRangeActive(state, r.from, r.to)) {
			pushSourceLines(pending, state, r.from, r.to);
		} else {
			pending.push({
				from: r.from,
				to: r.to,
				deco: Decoration.replace({ widget: new BlockMathWidget(r.source), block: true })
			});
		}
	}

	pending.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
	return Decoration.set(
		pending.map((p) => p.deco.range(p.from, p.to)),
		true
	);
}

export const mathBlockField = StateField.define<DecorationSet>({
	create: (state) => buildBlockMathDecorations(state),
	update(deco, tr) {
		if (tr.docChanged || tr.reconfigured) {
			return buildBlockMathDecorations(tr.state);
		}
		if (tr.effects.some((e) => e.is(previewModeEffect))) {
			return buildBlockMathDecorations(tr.state);
		}
		// Active state is line-based, so same-line selection motion
		// (Left/Right, direction flips) reuses the set instead of churning
		// layout on every keypress.
		// Line changes rebuild only when they reveal or hide a block, so moving
		// through a math-heavy note doesn't redraw every block per line.
		if (tr.selection) {
			const before = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
			const after = tr.state.doc.lineAt(tr.state.selection.main.head).number;
			if (before !== after && activeBlocks(tr.startState) !== activeBlocks(tr.state)) {
				return buildBlockMathDecorations(tr.state);
			}
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});
