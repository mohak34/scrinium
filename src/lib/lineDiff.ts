export interface DiffLine {
	kind: 'same' | 'add' | 'del';
	text: string;
}

// Line diff of `a` into `b` (an LCS over the lines between the common
// head and tail). A middle too big for the LCS table shows as one
// removed block and one added block.
export function lineDiff(a: string, b: string, maxCells = 4_000_000): DiffLine[] {
	const x = a.split('\n');
	const y = b.split('\n');
	let head = 0;
	while (head < x.length && head < y.length && x[head] === y[head]) head++;
	let tail = 0;
	while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail])
		tail++;
	const xs = x.slice(head, x.length - tail);
	const ys = y.slice(head, y.length - tail);
	const same = (text: string): DiffLine => ({ kind: 'same', text });
	const out: DiffLine[] = x.slice(0, head).map(same);
	const n = xs.length;
	const m = ys.length;
	if (n * m > maxCells) {
		for (const text of xs) out.push({ kind: 'del', text });
		for (const text of ys) out.push({ kind: 'add', text });
	} else {
		// lcs[i * (m + 1) + j]: LCS length of xs[i..] and ys[j..].
		const lcs = new Uint32Array((n + 1) * (m + 1));
		for (let i = n - 1; i >= 0; i--)
			for (let j = m - 1; j >= 0; j--)
				lcs[i * (m + 1) + j] =
					xs[i] === ys[j]
						? lcs[(i + 1) * (m + 1) + j + 1] + 1
						: Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
		let i = 0;
		let j = 0;
		while (i < n || j < m) {
			if (i < n && j < m && xs[i] === ys[j]) out.push(same(xs[i++])), j++;
			else if (i < n && (j === m || lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]))
				out.push({ kind: 'del', text: xs[i++] });
			else out.push({ kind: 'add', text: ys[j++] });
		}
	}
	for (const text of x.slice(x.length - tail)) out.push(same(text));
	return out;
}
