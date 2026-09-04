/**
 * Note outline: ATX headings with 1-based line numbers. Skips fenced code
 * and a leading `---` frontmatter block (so future YAML `#` comments never
 * surface as headings). Pure text scan, no editor imports.
 */

export interface OutlineEntry {
	level: number;
	text: string;
	line: number;
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

export function parseOutline(text: string): OutlineEntry[] {
	const out: OutlineEntry[] = [];
	const lines = text.split('\n');
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Leading frontmatter block: skip through its closing fence.
		if (i === 0 && /^---\s*$/.test(line)) {
			let j = i + 1;
			while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j])) j++;
			i = j;
			continue;
		}
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
		if (!m) continue;
		const heading = m[2].trim();
		if (!heading) continue;
		out.push({ level: m[1].length, text: heading, line: i + 1 });
	}
	return out;
}
