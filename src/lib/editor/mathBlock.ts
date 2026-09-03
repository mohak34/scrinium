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

import { syntaxTree } from '@codemirror/language';
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import katex from 'katex';
import { previewModeEffect, isPreviewMode } from './livePreview';

const blockCache = new Map<string, string>();
function renderBlockMath(content: string): string {
	const hit = blockCache.get(content);
	if (hit !== undefined) return hit;
	try {
		const html = katex.renderToString(content, { throwOnError: false, displayMode: true });
		blockCache.set(content, html);
		return html;
	} catch {
		return `$$${content}$$`;
	}
}

class BlockMathWidget extends WidgetType {
	constructor(readonly content: string) {
		super();
	}
	eq(other: BlockMathWidget) {
		return other.content === this.content;
	}
	toDOM() {
		const div = document.createElement('div');
		div.className = 'cm-math-block';
		div.innerHTML = renderBlockMath(this.content);
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
	return cursorLine >= startLine && cursorLine <= endLine;
}

function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
	return aFrom <= bTo && bFrom <= aTo;
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

export interface MathBlockRange {
	from: number;
	to: number;
	source: string;
}

// All display-math ranges in the doc, regardless of active state. Shared by
// the decoration builder and the arrow-key handler in CodeEditor, so both
// agree on where the blocks are.
export function findMathBlockRanges(state: EditorState): MathBlockRange[] {
	const ranges: MathBlockRange[] = [];
	const fencedRanges: Array<[number, number]> = [];

	// 1. ```math fenced blocks via the syntax tree.
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== 'FencedCode') return;
			fencedRanges.push([node.from, node.to]);
			const info = node.node.getChild('CodeInfo');
			if (!info || state.doc.sliceString(info.from, info.to).trim() !== 'math') return false;
			const textNode = node.node.getChild('CodeText');
			const source = textNode ? state.doc.sliceString(textNode.from, textNode.to).trim() : '';
			if (!source) return false;
			ranges.push({ from: node.from, to: node.to, source });
			return false;
		}
	});

	// 2. Own-line $$...$$ blocks. Strict shape only: opening $$ at line
	// start (indent allowed) with nothing after it, closing $$ on its own
	// line, or the whole thing on one line. Anything else stays raw text.
	// Never spans a fenced block, so math and code cannot overlap.
	const docText = state.doc.toString();
	const blockRegex = /\$\$([\s\S]*?)\$\$/g;
	let m: RegExpExecArray | null;
	while ((m = blockRegex.exec(docText)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		const content = m[1];
		if (!content.trim() || content.length > 2000) continue;
		if (fencedRanges.some(([f, t]) => overlaps(f, t, start, end))) continue;
		const startLine = state.doc.lineAt(start);
		const endLine = state.doc.lineAt(Math.max(start, end - 1));
		if (startLine.number === endLine.number) {
			// Single line: allow `$$...$$` anywhere on the line.
			if (content.includes('\n')) continue;
		} else {
			// Multi-line: fences on their own lines.
			if (state.doc.sliceString(startLine.from, start).trim() !== '') continue;
			if (state.doc.sliceString(start + 2, startLine.to).trim() !== '') continue;
			if (end - 2 < endLine.from) continue;
			if (state.doc.sliceString(endLine.from, end - 2).trim() !== '') continue;
			if (state.doc.sliceString(end, endLine.to).trim() !== '') continue;
		}
		const source = content.trim();
		if (!source) continue;
		ranges.push({ from: start, to: end, source });
	}

	ranges.sort((a, b) => a.from - b.from);
	return ranges;
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
		if (tr.docChanged || tr.reconfigured || tr.selection) {
			return buildBlockMathDecorations(tr.state);
		}
		if (tr.effects.some((e) => e.is(previewModeEffect))) {
			return buildBlockMathDecorations(tr.state);
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});
