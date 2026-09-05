/**
 * Heading and list folding ranges (pure text scan, no editor imports).
 *
 * A heading folds until the next equal-or-higher heading; a list item
 * folds its deeper-indented children. Shared guards: `#nospace`, setext
 * underlines, fenced code and the frontmatter block never start, end or
 * split a range.
 */

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^(#{1,6})\s+/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+/;

export interface FoldRange {
	from: number;
	to: number;
}

/** Offsets of fenced-code spans (inclusive), line-based like tags.ts. */
function fenceRanges(lines: string[]): Array<{ from: number; to: number }> {
	const ranges: Array<{ from: number; to: number }> = [];
	let off = 0;
	let open: number | null = null;
	for (const line of lines) {
		if (FENCE_RE.test(line)) {
			if (open === null) open = off;
			else {
				ranges.push({ from: open, to: off + line.length });
				open = null;
			}
		}
		off += line.length + 1;
	}
	if (open !== null) ranges.push({ from: open, to: off });
	return ranges;
}

/** End offset (exclusive) of a leading `---` block, else 0. */
function frontmatterEnd(lines: string[]): number {
	if (!/^---\s*$/.test(lines[0] ?? '')) return 0;
	let off = lines[0].length + 1;
	for (let i = 1; i < lines.length; i++) {
		if (/^(---|\.\.\.)\s*$/.test(lines[i])) return off + lines[i].length + 1;
		off += lines[i].length + 1;
	}
	return off;
}

export function headingFoldRange(docText: string, lineNo: number): FoldRange | null {
	const lines = docText.split('\n');
	if (lineNo < 1 || lineNo > lines.length) return null;
	const head = HEADING_RE.exec(lines[lineNo - 1]);
	if (!head) return null;
	const level = head[1].length;

	// Line start offsets, so ranges stay line-granular for the gutter.
	const starts: number[] = [];
	let off = 0;
	for (const line of lines) {
		starts.push(off);
		off += line.length + 1;
	}
	const fences = fenceRanges(lines);
	const fmEnd = frontmatterEnd(lines);
	const inside = (at: number): boolean =>
		(at < fmEnd && fmEnd > 0) || fences.some((r) => at >= r.from && at < r.to);
	if (inside(starts[lineNo - 1])) return null;

	let endLine = lines.length;
	for (let i = lineNo + 1; i <= lines.length; i++) {
		const lm = HEADING_RE.exec(lines[i - 1]);
		if (!lm || lm[1].length > level) continue;
		if (inside(starts[i - 1])) continue;
		endLine = i - 1;
		break;
	}
	if (endLine <= lineNo) return null;
	// A trailing newline leaves a phantom empty line; folding it hides
	// nothing but shifts the placeholder for no reason.
	while (endLine > lineNo && lines[endLine - 1] === '') endLine--;
	if (endLine <= lineNo) return null;
	return { from: starts[lineNo - 1] + lines[lineNo - 1].length, to: starts[endLine - 1] + lines[endLine - 1].length };
}

/**
 * A list item folds its deeper-indented children (bullets, tasks and
 * ordered items alike). Blank lines inside count only when deeper content
 * follows; trailing blanks trim like headings.
 */
export function listFoldRange(docText: string, lineNo: number): FoldRange | null {
	const lines = docText.split('\n');
	if (lineNo < 1 || lineNo > lines.length) return null;
	const head = LIST_RE.exec(lines[lineNo - 1]);
	if (!head) return null;
	const base = head[1].length;

	const starts: number[] = [];
	let off = 0;
	for (const line of lines) {
		starts.push(off);
		off += line.length + 1;
	}
	const fences = fenceRanges(lines);
	const fmEnd = frontmatterEnd(lines);
	const inside = (at: number): boolean =>
		(at < fmEnd && fmEnd > 0) || fences.some((r) => at >= r.from && at < r.to);
	if (inside(starts[lineNo - 1])) return null;

	let endLine = lineNo;
	for (let i = lineNo + 1; i <= lines.length; i++) {
		const line = lines[i - 1];
		if (line.trim() === '') continue;
		const lm = LIST_RE.exec(line);
		const indent = line.length - line.trimStart().length;
		// A heading or dedented line ends the list; same-or-shallower items
		// are siblings, only deeper ones fold.
		if (HEADING_RE.test(line) || !lm || indent <= base) break;
		if (inside(starts[i - 1])) break;
		endLine = i;
	}
	if (endLine <= lineNo) return null;
	return { from: starts[lineNo - 1] + lines[lineNo - 1].length, to: starts[endLine - 1] + lines[endLine - 1].length };
}
