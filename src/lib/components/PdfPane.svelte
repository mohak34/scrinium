<script lang="ts">
	import { onMount } from 'svelte';
	import { loadPdfjs } from '$lib/pdf/pdfjs';
	import type { PDFDocumentProxy } from 'pdfjs-dist';
	import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';

	// A vault PDF beside the editor. pdf.js renders only the pages near the
	// viewport; highlights, drawings and text notes are written into the PDF
	// itself (standard annotations any reader shows) and saved back over the
	// vault file. Mounted per path: a new path is a new pane.
	interface Props {
		path: string;
		onClose: () => void;
	}
	let { path, onClose }: Props = $props();

	// pdf.js editor modes (AnnotationEditorType), kept here so the toolbar
	// renders before the library loads.
	const NONE = 0;
	const TOOLS = [
		{ mode: NONE, icon: 'arrow_selector_tool', title: 'Select text' },
		{ mode: 9, icon: 'ink_highlighter', title: 'Highlight' },
		{ mode: 15, icon: 'draw', title: 'Draw' },
		{ mode: 3, icon: 'title', title: 'Text note' }
	];

	let container = $state<HTMLDivElement>();
	let viewer: PDFViewer | undefined;
	let doc: PDFDocumentProxy | undefined;
	let failed = $state('');
	let page = $state(1);
	let pages = $state(0);
	let mode = $state(NONE);
	let saveState = $state<'saved' | 'dirty' | 'saving' | 'failed'>('saved');

	const name = $derived(path.split('/').pop() ?? path);
	const url = $derived('/api/assets/' + path.split('/').map(encodeURIComponent).join('/'));

	// Each save uploads the whole file (original bytes plus every
	// annotation), so they wait for a 10 s pause, the tab hiding, or the
	// pane closing. Edits made while one is in flight mark the PDF dirty
	// again and queue the next.
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<void> | undefined;
	let closed = false;
	function scheduleSave(wait = 10_000) {
		clearTimeout(timer);
		timer = setTimeout(() => void save(), wait);
	}
	async function save() {
		clearTimeout(timer);
		await saving;
		if (!doc || saveState === 'saved') return;
		const current = doc;
		saving = (async () => {
			saveState = 'saving';
			current.annotationStorage.resetModified();
			try {
				const bytes = await current.saveDocument();
				const res = await fetch(url, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/pdf' },
					body: bytes
				});
				if (!res.ok) throw new Error(String(res.status));
				if (saveState === 'saving') saveState = 'saved';
			} catch {
				saveState = 'failed';
				if (!closed) scheduleSave(5000);
			}
		})();
		await saving;
	}

	function setMode(next: number) {
		if (viewer) viewer.annotationEditorMode = { mode: next };
	}

	onMount(() => {
		let gone = false;
		const unsaved = (e: BeforeUnloadEvent) => {
			if (saveState !== 'saved') e.preventDefault();
		};
		window.addEventListener('beforeunload', unsaved);
		const hidden = () => {
			if (document.visibilityState === 'hidden') void save();
		};
		document.addEventListener('visibilitychange', hidden);

		void (async () => {
			try {
				const [{ lib, viewer: v, BinaryDataFactory }, res] = await Promise.all([
					loadPdfjs(),
					// The asset route lets browsers cache for an hour; annotations
					// change the file, so always read the current copy.
					fetch(url, { cache: 'no-store' })
				]);
				if (!res.ok) throw new Error(res.status === 404 ? 'File not found' : `Load failed (${res.status})`);
				const data = new Uint8Array(await res.arrayBuffer());
				if (gone || !container) return;
				const eventBus = new v.EventBus();
				const linkService = new v.PDFLinkService({ eventBus });
				viewer = new v.PDFViewer({
					container,
					eventBus,
					linkService,
					annotationEditorMode: lib.AnnotationEditorType.NONE,
					// pdf.js's own viewer defaults; the highlight tool needs a list.
					annotationEditorHighlightColors:
						'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F'
				});
				linkService.setViewer(viewer);
				eventBus.on('pagesinit', () => {
					if (viewer) viewer.currentScaleValue = 'page-width';
				});
				eventBus.on('pagechanging', (e: { pageNumber: number }) => (page = e.pageNumber));
				eventBus.on('annotationeditormodechanged', (e: { mode: number }) => (mode = e.mode));

				const task = lib.getDocument({ data, BinaryDataFactory, enableHWA: true });
				const loaded = await task.promise;
				if (gone) {
					void task.destroy();
					return;
				}
				doc = loaded;
				pages = loaded.numPages;
				// Typed as null in pdf.js's declarations; it is a callback slot.
				Object.assign(loaded.annotationStorage, {
					onSetModified: () => {
						saveState = 'dirty';
						scheduleSave();
					}
				});
				viewer.setDocument(loaded);
				linkService.setDocument(loaded);
			} catch (e) {
				failed = e instanceof Error ? e.message : 'Could not open this PDF';
			}
		})();

		return () => {
			gone = true;
			window.removeEventListener('beforeunload', unsaved);
			document.removeEventListener('visibilitychange', hidden);
			// Closing or switching files still writes pending annotations, then
			// frees the worker's copy of the document.
			// No retry after this one: the document is destroyed with the pane.
			const last = doc;
			closed = true;
			void save().finally(() => {
				viewer?.cleanup();
				void last?.loadingTask.destroy();
			});
		};
	});
</script>

<section class="pane" aria-label="PDF {name}">
	<div class="bar">
		<span class="material-symbols-outlined kind">picture_as_pdf</span>
		<span class="name" title={path}>{name}</span>
		{#if pages}<span class="pages">{page} / {pages}</span>{/if}
		<span class="save" class:bad={saveState === 'failed'}>
			{saveState === 'saving' ? 'Saving' : saveState === 'failed' ? 'Save failed, retrying' : ''}
		</span>
		{#each TOOLS as t (t.mode)}
			<button
				class="btn"
				class:on={mode === t.mode}
				title={t.title}
				aria-pressed={mode === t.mode}
				onclick={() => setMode(t.mode)}
			>
				<span class="material-symbols-outlined">{t.icon}</span>
			</button>
		{/each}
		<span class="vsep"></span>
		<button class="btn" title="Zoom out" onclick={() => viewer?.decreaseScale()}>
			<span class="material-symbols-outlined">zoom_out</span>
		</button>
		<button class="btn" title="Zoom in" onclick={() => viewer?.increaseScale()}>
			<span class="material-symbols-outlined">zoom_in</span>
		</button>
		<button
			class="btn"
			title="Fit width"
			onclick={() => {
				if (viewer) viewer.currentScaleValue = 'page-width';
			}}
		>
			<span class="material-symbols-outlined">fit_width</span>
		</button>
		<span class="vsep"></span>
		<button class="btn" title="Close PDF" onclick={onClose}>
			<span class="material-symbols-outlined">close</span>
		</button>
	</div>
	<div class="stage">
		{#if failed}
			<p class="error">{failed}</p>
		{/if}
		<div class="scroller" bind:this={container}>
			<div class="pdfViewer"></div>
		</div>
	</div>
</section>

<style>
	.pane {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		height: 100vh;
		border-left: 1px solid var(--line);
		background: var(--panel);
	}
	.bar {
		height: 44px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 8px 0 14px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
		background: var(--bg);
	}
	.kind {
		font-size: 18px;
		color: var(--text-3);
		margin-right: 6px;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-weight: 500;
	}
	.pages {
		margin-left: 10px;
		color: var(--text-3);
		font: var(--fs) var(--font-mono);
		white-space: nowrap;
	}
	.save {
		flex: 1;
		min-width: 0;
		margin-left: 10px;
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.save.bad {
		color: var(--error);
	}
	.btn {
		height: 30px;
		min-width: 30px;
		padding: 0 5px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text-2);
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.btn.on {
		color: var(--accent);
	}
	.vsep {
		width: 1px;
		height: 18px;
		background: var(--line-2);
		margin: 0 6px;
	}
	.stage {
		flex: 1;
		min-height: 0;
		position: relative;
	}
	/* pdf.js requires an absolutely positioned scroll container. */
	.scroller {
		position: absolute;
		inset: 0;
		overflow: auto;
	}
	.error {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--text-3);
		z-index: 1;
	}
</style>
