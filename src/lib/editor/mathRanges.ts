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

// True when completions or snippet triggers may fire at pos: inside a
// display-math block (closed or still being typed), or on a line with an
// unclosed inline `$` - but never inside code.
export function inMathRegion(state: EditorState, pos: number): boolean {
	const blocks = findMathBlockRanges(state);
	if (blocks.some((r) => pos >= r.from && pos <= r.to)) return true;
	const inner = syntaxTree(state).resolveInner(Math.min(pos, state.doc.length), 0);
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
			return false;
		cur = cur.parent;
	}
	const line = state.doc.lineAt(pos);
	const before = line.text.slice(0, pos - line.from);
	if (before.replace(/\\\$/g, '').replace(/\$\$/g, '').includes('$')) return true;
	// Unclosed `$$` opener earlier in the doc (a display block being typed).
	// Closed blocks and fenced code don't count toward the parity.
	const fenced: Array<[number, number]> = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name === 'FencedCode') {
				fenced.push([node.from, node.to]);
				return false;
			}
		}
	});
	const textBefore = state.doc.sliceString(0, pos);
	const fences = /\$\$/g;
	let count = 0;
	let fm: RegExpExecArray | null;
	while ((fm = fences.exec(textBefore)) !== null) {
		const at = fm.index;
		if (blocks.some((r) => at >= r.from && at < r.to)) continue;
		if (fenced.some(([f, t]) => at >= f && at < t)) continue;
		count++;
	}
	return count % 2 === 1;
}
