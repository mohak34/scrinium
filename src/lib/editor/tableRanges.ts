/**
 * Shared GFM table range finder (parser only, no view imports).
 *
 * Only top-level tables count: a table inside a quote, callout or list
 * would need its `>` / indent prefixes kept, so those stay plain text.
 * Ranges cover whole lines. Tables in frontmatter or overlapping display
 * math are skipped so two block replaces never claim the same lines.
 *
 * Used by tableBlock.ts (the rendered widget) and livePreview.ts (inline
 * math, wikilinks and tags never decorate inside a table, so no inline
 * replace overlaps the table's block replace).
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { fmEnd, perDoc, touchesSpan } from './docRanges';
import { findMathBlockRanges } from './mathRanges';

export interface TableRange {
	from: number;
	to: number;
	source: string;
}

/** Top-level tables in doc order, cached per document. */
export const findTableRanges = perDoc((state: EditorState): readonly TableRange[] => {
	const fm = fmEnd(state);
	const math = findMathBlockRanges(state);
	const out: TableRange[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== 'Table') return;
			if (node.node.parent?.name === 'Document') {
				const from = state.doc.lineAt(node.from).from;
				const to = state.doc.lineAt(node.to).to;
				if (from >= fm && !touchesSpan(math, from, to)) {
					out.push({ from, to, source: state.doc.sliceString(from, to) });
				}
			}
			return false;
		}
	});
	return out;
});
