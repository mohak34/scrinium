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

// Font-free stroke icons for print/PDF. The Material Symbols webfont embeds
// as Type 3 in Chrome PDFs, which breaks text selection around it - these
// inline SVGs print as vectors and leave surrounding text selectable.
const CALLOUT_SVG_PATHS: Record<CalloutKind, string> = {
	note: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
	abstract:
		'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	todo: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
	tip: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
	success: '<path d="M20 6 9 17l-5-5"/>',
	question:
		'<circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
	warning:
		'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	failure: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
	example:
		'<path d="M10 2v7.5a2 2 0 0 1-.2.9L4.7 20.5a1 1 0 0 0 .9 1.5h12.8a1 1 0 0 0 .9-1.5L14.2 10.4a2 2 0 0 1-.2-.9V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
	quote:
		'<path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v7a3 3 0 0 1-3 3"/><path d="M20 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v7a3 3 0 0 1-3 3"/>'
};

function svgWrap(inner: string): string {
	return `<svg class="callout-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Font-free callout icon for print/PDF (keeps nearby text selectable). */
export function calloutIconSvg(kind: CalloutKind): string {
	return svgWrap(CALLOUT_SVG_PATHS[kind]);
}

/** Font-free fold chevron for print/PDF. */
export function calloutChevronSvg(open: boolean): string {
	return svgWrap(open ? '<path d="m18 15-6-6-6 6"/>' : '<path d="m6 9 6 6 6-6"/>');
}

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
 * Box lines for a plain `>` quote: every doc line the Blockquote spans,
 * or null when a callout owns those lines (it paints its own box) or the
 * block sits inside frontmatter (raw YAML, never pretty).
 */
export function quoteBoxLines(
	state: EditorState,
	from: number,
	to: number,
	callouts: FoundCallout[],
	fmEnd: number
): number[] | null {
	const firstLine = state.doc.lineAt(from).number;
	const lastLine = state.doc.lineAt(Math.max(from, to - 1)).number;
	if (fmEnd > 0 && from < fmEnd) return null;
	for (let n = firstLine; n <= lastLine; n++) {
		if (callouts.some((c) => n >= c.firstLine && n <= c.lastLine)) return null;
	}
	const out: number[] = [];
	for (let n = firstLine; n <= lastLine; n++) {
		if (n >= 1 && n <= state.doc.lines) out.push(n);
	}
	return out;
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
