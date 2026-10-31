import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Fonts, CMaps and image decoders pdf.js asks for on demand. Vite emits each
// as a hashed asset, so they are found by file name, not by a base URL.
const ROOT = '/node_modules/pdfjs-dist/';
const resources = import.meta.glob<string>(
	'/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*.{bcmap,pfb,ttf,wasm}',
	{ query: '?url', import: 'default' }
);
const DIRS = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' } as const;

class BundledData {
	async fetch({ kind, filename }: { kind: keyof typeof DIRS; filename: string }) {
		const url = await resources[`${ROOT}${DIRS[kind]}/${filename}`]?.();
		if (!url) throw new Error(`pdf.js resource missing: ${filename}`);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`pdf.js resource failed: ${filename}`);
		return new Uint8Array(await res.arrayBuffer());
	}
}

// The viewer module reads the core library from globalThis, so it has to
// load second. Its CSS is a dynamic import too: a static one gets linked
// into every page that might open a PDF.
async function load() {
	const [lib] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/web/pdf_viewer.css')]);
	lib.GlobalWorkerOptions.workerSrc = workerUrl;
	(globalThis as { pdfjsLib?: typeof lib }).pdfjsLib = lib;
	const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs');
	return { lib, viewer, BinaryDataFactory: BundledData };
}

let loading: ReturnType<typeof load> | undefined;
export const loadPdfjs = () => (loading ??= load());
