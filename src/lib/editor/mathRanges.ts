/**
 * Shared display-math range finder (no editor imports, parser + regex only).
 *
 * Two block forms:
 *   1. ```math fenced blocks (Lezer tree, CodeInfo === 'math')
 *   2. `$$` fences paired in document order. A fence counts only on its
 *      own line (indent/trailing space allowed) and outside fenced code.
 *      Pairs with blank content don't consume: the second fence re-pairs
 *      forward, so a fresh Ctrl+M `$$` placeholder can neither glue to a
 *      distant block nor eat its opener. Single-line `$$x$$` allowed
 *      anywhere. Never spans a fenced block, so math and code cannot
 *      overlap.
 *
 * Used by mathBlock.ts (decorations) and livePreview.ts (so the inline-$
 * scan never emits a replace inside a block range - overlapping replaces
 * corrupt the RangeSetBuilder).
 *
 * Frontmatter is excluded everywhere: properties hold YAML, never math,
 * and the properties box owns those lines (same overlap rule as code).
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { codeRanges, fmEnd, inSpan, inSpanClosed, perDoc, spanInside, touchesSpan } from './docRanges';

/**
 * Inline `$...$` on one line, pandoc's rule: no space just inside either
 * `$`, no escaped `\$` as a delimiter, and a closing `$` followed by a digit
 * is a price ("$5-$10"), not math. So `$0$` renders and "$5 and $10" stays
 * text. Fresh per call: the `g` flag carries lastIndex. Shared by the editor
 * and the print/share renderer.
 */
export const inlineMathRegex = () => /(?<![\\$])\$(?!\$)([^\s$](?:[^$\n]{0,198}?[^\s$\\])?)\$(?![$\d])/g;

export interface MathBlockRange {
	from: number;
	to: number;
	source: string;
}

// Own-line `$$` fence starts outside code and frontmatter: `$$` written
// inside code is literal text.
function ownLineFences(state: EditorState, docText: string): number[] {
	const code = codeRanges(state);
	const fm = fmEnd(state);
	const fences: number[] = [];
	const fenceRe = /^[ \t]*\$\$[ \t]*\r?$/gm;
	let m: RegExpExecArray | null;
	while ((m = fenceRe.exec(docText)) !== null) {
		const at = m.index + m[0].indexOf('$$');
		if (at < fm || inSpan(code, at)) continue;
		fences.push(at);
	}
	return fences;
}

/** Display-math blocks in doc order, cached per document. */
export const findMathBlockRanges = perDoc((state): readonly MathBlockRange[] => {
	const ranges: MathBlockRange[] = [];
	const docText = state.doc.toString();
	const fm = fmEnd(state);
	const code = codeRanges(state);

	// 1. ```math fenced blocks via the syntax tree.
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== 'FencedCode') return;
			if (node.from < fm) return false;
			const info = node.node.getChild('CodeInfo');
			if (!info || state.doc.sliceString(info.from, info.to).trim() !== 'math') return false;
			const textNode = node.node.getChild('CodeText');
			const source = textNode ? state.doc.sliceString(textNode.from, textNode.to).trim() : '';
			if (!source) return false;
			ranges.push({ from: node.from, to: node.to, source });
			return false;
		}
	});

	const fences = ownLineFences(state, docText);

	// 2. Pair own-line fences in order. A blank pair does not consume its
	// second fence, so placeholders re-pair forward instead of gluing.
	let i = 0;
	while (i + 1 < fences.length) {
		const a = fences[i];
		const b = fences[i + 1];
		const content = docText.slice(a + 2, b);
		// A pair never spans code: a stray `$$` above a code block must not
		// swallow it.
		if (!content.trim() || content.length > 2000 || spanInside(code, a, b)) {
			i += 1;
			continue;
		}
		ranges.push({ from: a, to: b + 2, source: content.trim() });
		i += 2;
	}

	// 3. Single-line `$$x$$` anywhere (fence lines can't qualify: exactly
	// `$$` alone never holds a same-line pair). Blocks from 1 and 2 never
	// overlap, so sorted they take a binary search; a match starts at or
	// after the previous one ends, so among its own kind only the last can
	// touch it.
	ranges.sort((a, b) => a.from - b.from);
	const blocks = ranges.slice();
	let last: MathBlockRange | null = null;
	const singleRe = /\$\$([^\n]*?)\$\$/g;
	let m: RegExpExecArray | null;
	while ((m = singleRe.exec(docText)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		const content = m[1];
		if (!content.trim() || content.length > 2000) continue;
		if (start < fm) continue;
		if (touchesSpan(code, start, end) || touchesSpan(blocks, start, end)) continue;
		if (last && start <= last.to) continue;
		last = { from: start, to: end, source: content.trim() };
		ranges.push(last);
	}

	ranges.sort((a, b) => a.from - b.from);
	return ranges;
});

// True when completions or snippet triggers may fire at pos: inside a
// display-math block (closed or still being typed), or on a line with an
// unclosed inline `$` - but never inside code.
export function inMathRegion(state: EditorState, pos: number): boolean {
	const blocks = findMathBlockRanges(state);
	if (inSpanClosed(blocks, pos)) return true;
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
	// Inside inline math only while a `$` is open: an odd count. A closed
	// `$x$` earlier on the line leaves the rest of the line as prose.
	const singles = before.replace(/\\\$/g, '').replace(/\$\$/g, '').split('$').length - 1;
	if (singles % 2 === 1) return true;
	// Unclosed `$$` opener earlier in the doc (a display block being typed).
	// Closed blocks and fenced code don't count toward the parity. Any `$$`
	// occurrence counts here (own-line or mid-line) - pairing lives in
	// findMathBlockRanges, parity only answers "is one still open".
	const code = codeRanges(state);
	const textBefore = state.doc.sliceString(0, pos);
	const fm = fmEnd(state);
	const occur = /\$\$/g;
	let count = 0;
	let m: RegExpExecArray | null;
	while ((m = occur.exec(textBefore)) !== null) {
		const at = m.index;
		if (at < fm || inSpan(blocks, at) || inSpan(code, at)) continue;
		count++;
	}
	return count % 2 === 1;
}
