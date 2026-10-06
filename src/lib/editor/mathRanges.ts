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
import { parseFrontmatter } from './frontmatter';

export interface MathBlockRange {
	from: number;
	to: number;
	source: string;
}

function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
	return aFrom <= bTo && bFrom <= aTo;
}

// Own-line `$$` fence starts outside code, plus every code range (fenced,
// indented and inline): `$$` written inside code is literal text.
function scanDoc(state: EditorState): { fences: number[]; fenced: Array<[number, number]> } {
	const fenced: Array<[number, number]> = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') {
				fenced.push([node.from, node.to]);
				return false;
			}
		}
	});
	const fences: number[] = [];
	const docText = state.doc.toString();
	const fmEnd = parseFrontmatter(docText)?.bodyStart ?? 0;
	const fenceRe = /^[ \t]*\$\$[ \t]*\r?$/gm;
	let fm: RegExpExecArray | null;
	while ((fm = fenceRe.exec(docText)) !== null) {
		const at = fm.index + fm[0].indexOf('$$');
		if (fmEnd > 0 && at < fmEnd) continue;
		if (fenced.some(([f, t]) => at >= f && at < t)) continue;
		fences.push(at);
	}
	return { fences, fenced };
}

export function findMathBlockRanges(state: EditorState): MathBlockRange[] {
	const ranges: MathBlockRange[] = [];
	const docText = state.doc.toString();
	const fmEnd = parseFrontmatter(docText)?.bodyStart ?? 0;

	// 1. ```math fenced blocks via the syntax tree.
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== 'FencedCode') return;
			if (fmEnd > 0 && node.from < fmEnd) return false;
			const info = node.node.getChild('CodeInfo');
			if (!info || state.doc.sliceString(info.from, info.to).trim() !== 'math') return false;
			const textNode = node.node.getChild('CodeText');
			const source = textNode ? state.doc.sliceString(textNode.from, textNode.to).trim() : '';
			if (!source) return false;
			ranges.push({ from: node.from, to: node.to, source });
			return false;
		}
	});

	const { fences, fenced } = scanDoc(state);

	// 2. Pair own-line fences in order. A blank pair does not consume its
	// second fence, so placeholders re-pair forward instead of gluing.
	let i = 0;
	while (i + 1 < fences.length) {
		const a = fences[i];
		const b = fences[i + 1];
		const content = docText.slice(a + 2, b);
		// A pair never spans code: a stray `$$` above a code block must not
		// swallow it.
		if (!content.trim() || content.length > 2000 || fenced.some(([f, t]) => f > a && t < b)) {
			i += 1;
			continue;
		}
		ranges.push({ from: a, to: b + 2, source: content.trim() });
		i += 2;
	}

	// 3. Single-line `$$x$$` anywhere (fence lines can't qualify: exactly
	// `$$` alone never holds a same-line pair).
	const singleRe = /\$\$([^\n]*?)\$\$/g;
	let m: RegExpExecArray | null;
	while ((m = singleRe.exec(docText)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		const content = m[1];
		if (!content.trim() || content.length > 2000) continue;
		if (fmEnd > 0 && start < fmEnd) continue;
		if (fenced.some(([f, t]) => overlaps(f, t, start, end))) continue;
		if (ranges.some((r) => overlaps(r.from, r.to, start, end))) continue;
		ranges.push({ from: start, to: end, source: content.trim() });
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
	// Inside inline math only while a `$` is open: an odd count. A closed
	// `$x$` earlier on the line leaves the rest of the line as prose.
	const singles = before.replace(/\\\$/g, '').replace(/\$\$/g, '').split('$').length - 1;
	if (singles % 2 === 1) return true;
	// Unclosed `$$` opener earlier in the doc (a display block being typed).
	// Closed blocks and fenced code don't count toward the parity. Any `$$`
	// occurrence counts here (own-line or mid-line) - pairing lives in
	// findMathBlockRanges, parity only answers "is one still open".
	const { fenced } = scanDoc(state);
	const textBefore = state.doc.sliceString(0, pos);
	const fmEnd = parseFrontmatter(state.doc.toString())?.bodyStart ?? 0;
	const occur = /\$\$/g;
	let count = 0;
	let fm: RegExpExecArray | null;
	while ((fm = occur.exec(textBefore)) !== null) {
		const at = fm.index;
		if (fmEnd > 0 && at < fmEnd) continue;
		if (blocks.some((r) => at >= r.from && at < r.to)) continue;
		if (fenced.some(([f, t]) => at >= f && at < t)) continue;
		count++;
	}
	return count % 2 === 1;
}
