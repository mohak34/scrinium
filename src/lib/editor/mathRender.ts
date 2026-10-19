/**
 * KaTeX for the editor's math widgets (inline `$` in livePreview.ts, blocks
 * in mathBlock.ts). KaTeX and its CSS load on the first math widget drawn,
 * so notes without math never fetch them; until then a widget shows its
 * source, then fills in and asks the view to re-measure.
 */

import type { EditorView } from '@codemirror/view';

type Katex = typeof import('katex').default;

let katex: Katex | null = null;
let loading: Promise<Katex> | undefined;
const cache = new Map<string, string>();

function toHtml(lib: Katex, source: string, display: boolean): string {
	const key = (display ? 'B' : 'I') + source;
	const hit = cache.get(key);
	if (hit !== undefined) return hit;
	try {
		const html = lib.renderToString(source, { throwOnError: false, displayMode: display });
		cache.set(key, html);
		return html;
	} catch {
		return display ? `$$${source}$$` : `$${source}$`;
	}
}

export function fillMath(el: HTMLElement, view: EditorView, source: string, display: boolean): void {
	if (katex) {
		el.innerHTML = toHtml(katex, source, display);
		return;
	}
	el.textContent = display ? `$$${source}$$` : `$${source}$`;
	loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
		([m]) => (katex = m.default)
	);
	void loading.then((lib) => {
		el.innerHTML = toHtml(lib, source, display);
		view.requestMeasure();
	});
}
