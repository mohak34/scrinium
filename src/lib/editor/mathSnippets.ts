/**
 * Math snippet triggers for fast lecture writing.
 *
 * Tab expands a shorthand word (`frac` -> `\frac{}{}` with the cursor
 * inside the braces, `x_12` -> `x_{12}`); Space turns `a/b` into
 * `\frac{a}{b} `. Both fire inside math regions only (see inMathRegion)
 * and fall through to normal Tab/Space otherwise, so prose is untouched.
 * Single dispatch per expansion, so one undo step reverts it.
 */

import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { closeCompletion } from '@codemirror/autocomplete';
import { inMathRegion } from './mathRanges';

interface Snippet {
	insert: string;
	/** Cursor offset from the replacement start (defaults to end). */
	cursor?: number;
}

// Shorthand word -> expansion. Keep keys 2+ chars and collision-free with
// common English tails (suffix, inform) so prose Tab never misfires.
const WORD_SNIPPETS: Record<string, Snippet> = {
	frac: { insert: '\\frac{}{}', cursor: 6 },
	fr: { insert: '\\frac{}{}', cursor: 6 },
	sqrt: { insert: '\\sqrt{}', cursor: 6 },
	sq: { insert: '\\sqrt{}', cursor: 6 },
	sr: { insert: '\\sqrt{}', cursor: 6 },
	sum: { insert: '\\sum_{}^{}', cursor: 6 },
	prod: { insert: '\\prod_{}^{}', cursor: 6 },
	int: { insert: '\\int_{}^{}', cursor: 6 },
	lim: { insert: '\\lim_{}', cursor: 6 },
	log: { insert: '\\log' },
	sin: { insert: '\\sin' },
	cos: { insert: '\\cos' },
	tan: { insert: '\\tan' },
	inf: { insert: '\\infty' },
	al: { insert: '\\alpha' },
	be: { insert: '\\beta' },
	ga: { insert: '\\gamma' },
	de: { insert: '\\delta' },
	ep: { insert: '\\epsilon' },
	th: { insert: '\\theta' },
	la: { insert: '\\lambda' },
	mu: { insert: '\\mu' },
	nu: { insert: '\\nu' },
	pi: { insert: '\\pi' },
	rh: { insert: '\\rho' },
	si: { insert: '\\sigma' },
	ta: { insert: '\\tau' },
	ph: { insert: '\\phi' },
	om: { insert: '\\omega' },
	to: { insert: '\\to' }
};

const SUBSCRIPT_RE = /([A-Za-z0-9)\]])_([A-Za-z0-9]{2,})$/;
const WORD_RE = /([A-Za-z]+)$/;
const FRACTION_RE = /([A-Za-z0-9]+)\/([A-Za-z0-9]+)$/;

function lineBefore(state: EditorState, head: number) {
	const line = state.doc.lineAt(head);
	return { line, before: line.text.slice(0, head - line.from) };
}

// Tab: `x_12` -> `x_{12}`, else shorthand word -> LaTeX. Collapsed cursor
// in math only; selections keep the standard indent behavior.
export function expandMathSnippet(view: EditorView): boolean {
	const sel = view.state.selection.main;
	if (!sel.empty) return false;
	const { state } = view;
	const head = sel.head;
	const { line, before } = lineBefore(state, head);
	const sub = SUBSCRIPT_RE.exec(before);
	const word = WORD_RE.exec(before);
	if (!sub && !(word && WORD_SNIPPETS[word[1]])) return false;
	if (!inMathRegion(state, head)) return false;
	if (sub) {
		const from = head - sub[0].length;
		const insert = `${sub[1]}_{${sub[2]}}`;
		view.dispatch({
			changes: { from, to: head, insert },
			selection: { anchor: from + insert.length }
		});
	} else {
		const w = word![1];
		const s = WORD_SNIPPETS[w];
		let from = head - w.length;
		// `\frac` + Tab keeps its single backslash instead of doubling it.
		if (line.text[from - line.from - 1] === '\\') from -= 1;
		view.dispatch({
			changes: { from, to: head, insert: s.insert },
			selection: { anchor: from + (s.cursor ?? s.insert.length) }
		});
	}
	closeCompletion(view);
	return true;
}

// Space: `a/b` -> `\frac{a}{b} ` (the trailing space is re-inserted since
// the keypress itself is swallowed). Guards: `\/` italic correction and
// chained `a/b/c` stay untouched. Collapsed cursor in math only.
export function expandMathFraction(view: EditorView): boolean {
	const sel = view.state.selection.main;
	if (!sel.empty) return false;
	const { state } = view;
	const head = sel.head;
	const { before } = lineBefore(state, head);
	const fm = FRACTION_RE.exec(before);
	if (!fm) return false;
	const slashAt = before.length - fm[2].length - 1;
	if (before[slashAt - 1] === '\\') return false;
	const aStart = slashAt - fm[1].length;
	if (before[aStart - 1] === '/') return false;
	if (!inMathRegion(state, head)) return false;
	let from = head - fm[0].length;
	// `\alpha/b` keeps its single backslash: `\frac{\alpha}{b}`.
	const keepBs = before[aStart - 1] === '\\';
	if (keepBs) from -= 1;
	const insert = `\\frac{${keepBs ? '\\' : ''}${fm[1]}}{${fm[2]}} `;
	view.dispatch({
		changes: { from, to: head, insert },
		selection: { anchor: from + insert.length }
	});
	closeCompletion(view);
	return true;
}
