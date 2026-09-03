/**
 * Shared Obsidian-style callout helpers (no editor imports, parser only).
 *
 * Syntax (first line of a `>` blockquote):
 *   > [!note] Optional title
 *   > body...
 * Fold markers (`-` / `+`) parse but render expanded for now.
 *
 * Used by livePreview.ts (decorations) and renderNote.ts (print HTML).
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type CalloutKind =
	| 'note'
	| 'abstract'
	| 'info'
	| 'todo'
	| 'tip'
	| 'success'
	| 'question'
	| 'warning'
	| 'failure'
	| 'example'
	| 'quote';

const ALIASES: Record<string, CalloutKind> = {
	note: 'note',
	abstract: 'abstract',
	summary: 'abstract',
	tldr: 'abstract',
	info: 'info',
	todo: 'info',
	tip: 'tip',
	hint: 'tip',
	important: 'tip',
	success: 'success',
	check: 'success',
	done: 'success',
	question: 'question',
	help: 'question',
	faq: 'question',
	warning: 'warning',
	caution: 'warning',
	attention: 'warning',
	failure: 'failure',
	fail: 'failure',
	missing: 'failure',
	danger: 'failure',
	error: 'failure',
	bug: 'failure',
	example: 'example',
	quote: 'quote',
	cite: 'quote'
};

export const CALLOUT_ICONS: Record<CalloutKind, string> = {
	note: 'note',
	abstract: 'description',
	info: 'info',
	todo: 'info',
	tip: 'lightbulb',
	success: 'check_circle',
	question: 'help',
	warning: 'warning',
	failure: 'error',
	example: 'science',
	quote: 'format_quote'
};

export function canonicalCalloutType(raw: string): CalloutKind {
	return ALIASES[raw.toLowerCase()] ?? 'note';
}

export function defaultCalloutTitle(raw: string): string {
	const s = raw.trim().toLowerCase();
	return s ? s[0].toUpperCase() + s.slice(1) : 'Note';
}

export interface CalloutHeader {
	raw: string;
	kind: CalloutKind;
	fold: '' | '-' | '+';
	title: string;
}

/** Parse a single line as a callout header. Null when not one. */
export function parseCalloutHeader(lineText: string): CalloutHeader | null {
	const m = /^\s*>+\s*\[!([\w-]+)\]\s*([-+]?)\s*(.*)$/.exec(lineText);
	if (!m) return null;
	const raw = m[1];
	return {
		raw,
		kind: canonicalCalloutType(raw),
		fold: m[2] === '-' ? '-' : m[2] === '+' ? '+' : '',
		title: m[3].trim()
	};
}

export interface FoundCallout {
	kind: CalloutKind;
	raw: string;
	fold: '' | '-' | '+';
	title: string;
	/** Whole blockquote range (for overlap checks). */
	from: number;
	to: number;
	/** First-line range of the `[!type]-` marker (for widget replace). */
	headerFrom: number;
	headerTo: number;
	/** Per-line leading `> ` prefix ranges (for hiding when off-line). */
	prefixes: Array<{ from: number; to: number }>;
	/** Document line numbers covered, first to last. */
	firstLine: number;
	lastLine: number;
}

/**
 * Find callout blocks via Blockquote nodes. Line-based inside the node so
 * the Lezer `Link` parse of `[!note]` never matters.
 */
export function findCallouts(state: EditorState): FoundCallout[] {
	const out: FoundCallout[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== 'Blockquote') return;
			const firstLine = state.doc.lineAt(node.from);
			const header = parseCalloutHeader(
				state.doc.sliceString(firstLine.from, firstLine.to)
			);
			if (!header) return;
			const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
			const prefixes: Array<{ from: number; to: number }> = [];
			for (let n = firstLine.number; n <= lastLine; n++) {
				const line = state.doc.line(n);
				const pm = /^[ \t]*>+ ?/.exec(line.text);
				if (!pm) break;
				prefixes.push({ from: line.from, to: line.from + pm[0].length });
			}
			if (!prefixes.length) return;
			const hm = /\[![\w-]+\]\s*[-+]?/.exec(
				state.doc.sliceString(firstLine.from, firstLine.to)
			);
			if (!hm || hm.index === undefined) return;
			// hm.index is relative to the line slice, which starts at firstLine.from.
			const headerFrom = firstLine.from + (hm.index as number);
			const headerTo = headerFrom + hm[0].length;
			out.push({
				kind: header.kind,
				raw: header.raw,
				fold: header.fold,
				title: header.title,
				from: node.from,
				to: node.to,
				headerFrom,
				headerTo,
				prefixes,
				firstLine: firstLine.number,
				lastLine: firstLine.number + prefixes.length - 1
			});
			return false;
		}
	});
	return out;
}
