/**
 * Shared display-math range finder (no editor imports, parser + regex only).
 *
 * Two block forms:
 *   1. ```math fenced blocks (Lezer tree, CodeInfo === 'math')
 *   2. Own-line $$...$$ blocks (strict: fences on their own lines, or a
 *      single-line $$...$$). Never spans a fenced block, so math and code
 *      cannot overlap.
 *
 * Used by mathBlock.ts (decorations) and livePreview.ts (so the inline-$
 * scan never emits a replace inside a block range - overlapping replaces
 * corrupt the RangeSetBuilder).
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface MathBlockRange {
	from: number;
	to: number;
	source: string;
}

function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
	return aFrom <= bTo && bFrom <= aTo;
}

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

	// 2. Own-line $$...$$ blocks, strict shape only.
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
