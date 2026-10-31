<script lang="ts">
	import { onMount } from 'svelte';
	import { loadPdfjs } from '$lib/pdf/pdfjs';
	import { loadTree } from '$lib/stores/vault';
	import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
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
	let task: PDFDocumentLoadingTask | undefined;
	let failed = $state('');
	let page = $state(1);
	let pages = $state(0);
	let mode = $state(NONE);
	let saveState = $state<'saved' | 'dirty' | 'saving' | 'failed'>('saved');
	let eventBus: InstanceType<typeof import('pdfjs-dist/web/pdf_viewer.mjs').EventBus> | undefined;

	// Page and zoom per PDF path, and the dark-pages switch, kept in this
	// browser. Only the last 100 PDFs are remembered.
	const VIEW_STORAGE = 'scrinium:pdfViews';
	const DARK_STORAGE = 'scrinium:pdfDark';
	type View = { page: number; scale: string };
	function readViews(): Record<string, View> {
		try {
			const v = JSON.parse(localStorage.getItem(VIEW_STORAGE) ?? '{}');
			return v && typeof v === 'object' ? v : {};
		} catch {
			return {};
		}
	}
	let restored = false;
	function rememberView() {
		if (!viewer || !restored) return;
		const views = readViews();
		delete views[path];
		views[path] = { page: viewer.currentPageNumber, scale: viewer.currentScaleValue };
		const keys = Object.keys(views);
		for (const k of keys.slice(0, Math.max(0, keys.length - 100))) delete views[k];
		try {
			localStorage.setItem(VIEW_STORAGE, JSON.stringify(views));
		} catch {
			// Storage full or blocked: the next open starts at page 1.
		}
	}
	let dark = $state(typeof window !== 'undefined' && localStorage.getItem(DARK_STORAGE) === '1');
	function toggleDark() {
		dark = !dark;
		localStorage.setItem(DARK_STORAGE, dark ? '1' : '0');
	}

	// Page jump: the page counter turns into an input on click.
	let jumping = $state(false);
	function jump(value: string) {
		const n = Math.round(Number(value));
		if (viewer && n >= 1 && n <= pages) viewer.currentPageNumber = n;
		jumping = false;
	}

	// Find in the PDF (Ctrl+F while the pane has focus), pdf.js's own
	// controller: it highlights every match and scrolls to the selected one.
	let finding = $state(false);
	let query = $state('');
	let found = $state<{ current: number; total: number } | null>(null);
	let findInput = $state<HTMLInputElement>();
	function find(type: '' | 'again', previous = false) {
		eventBus?.dispatch('find', {
			source: null,
			type,
			query,
			caseSensitive: false,
			entireWord: false,
			highlightAll: true,
			findPrevious: previous,
			matchDiacritics: false
		});
	}
	function openFind() {
		finding = true;
		const selected = window.getSelection()?.toString().trim();
		if (selected && !selected.includes('\n')) {
			query = selected;
			find('');
		}
		requestAnimationFrame(() => findInput?.select());
	}
	function closeFind() {
		finding = false;
		found = null;
		eventBus?.dispatch('findbarclose', { source: null });
		container?.focus();
	}
	function paneKey(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
			// Ahead of the page's Mod+F, which opens the note editor's search.
			e.preventDefault();
			e.stopPropagation();
			openFind();
		}
	}

	const name = $derived(path.split('/').pop() ?? path);
	const assetUrl = (p: string) => '/api/assets/' + p.split('/').map(encodeURIComponent).join('/');
	// Where saves go and the version of that file they replace. The file
	// changed elsewhere (another tab, the phone): the server keeps it and
	// saves land in a conflict copy, which later saves then update.
	let target = '';
	let version: string | null = null;
	let copy = $state('');

	// Each save uploads the whole file (original bytes plus every
	// annotation), so they wait for a 10 s pause, the tab hiding, or the
	// pane closing. Edits made while one is in flight mark the PDF dirty
	// again and queue the next.
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<boolean> | undefined;
	let closed = false;
	function scheduleSave(wait = 10_000) {
		clearTimeout(timer);
		timer = setTimeout(() => void save(), wait);
	}
	// The bytes of the last save that failed, for the download fallback.
	let unsavedBytes: Blob | undefined;
	async function save(): Promise<boolean> {
		clearTimeout(timer);
		await saving;
		if (!doc || saveState === 'saved') return true;
		const current = doc;
		saving = (async () => {
			saveState = 'saving';
			current.annotationStorage.resetModified();
			let bytes: Blob | undefined;
			try {
				bytes = new Blob([await current.saveDocument()], { type: 'application/pdf' });
				const res = await fetch(assetUrl(target), {
					method: 'PUT',
					headers: { 'Content-Type': 'application/pdf', ...(version && { 'If-Match': version }) },
					body: bytes
				});
				if (!res.ok) throw new Error(String(res.status));
				const landed: { path: string; version: string } = await res.json();
				version = landed.version;
				if (landed.path !== target) {
					target = copy = landed.path;
					void loadTree();
				}
				unsavedBytes = undefined;
				if (saveState === 'saving') saveState = 'saved';
				return true;
			} catch {
				unsavedBytes = bytes;
				saveState = 'failed';
				if (!closed) scheduleSave(5000);
				return false;
			}
		})();
		return await saving;
	}

	// Closing keeps trying to save for about a minute, then hands the
	// annotated PDF to the browser as a download so no annotation is lost.
	async function saveOnClose() {
		for (let wait = 2000; saveState !== 'saved' && wait <= 32_000; ) {
			if (await save()) continue;
			await new Promise((r) => setTimeout(r, wait));
			wait *= 2;
		}
		if (saveState === 'saved' || !unsavedBytes) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(unsavedBytes);
		a.download = (target.split('/').pop() ?? 'document.pdf').replace(/\.pdf$/i, '') + ' (unsaved).pdf';
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
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

		target = path;
		void (async () => {
			try {
				// Only the version comes first; pdf.js then streams the file and
				// asks for the byte ranges of the pages on screen. `?v` pins every
				// range to that version, so saves never replace bytes this pane
				// did not read.
				const [{ lib, viewer: v, BinaryDataFactory }, res] = await Promise.all([
					loadPdfjs(),
					fetch(assetUrl(path), { method: 'HEAD', cache: 'no-store' })
				]);
				if (!res.ok) throw new Error(res.status === 404 ? 'File not found' : `Load failed (${res.status})`);
				version = res.headers.get('X-Asset-Version');
				if (gone || !container) return;
				const bus = (eventBus = new v.EventBus());
				const linkService = new v.PDFLinkService({ eventBus: bus });
				const findController = new v.PDFFindController({ eventBus: bus, linkService });
				viewer = new v.PDFViewer({
					container,
					eventBus: bus,
					linkService,
					findController,
					annotationEditorMode: lib.AnnotationEditorType.NONE,
					// pdf.js's own viewer defaults; the highlight tool needs a list.
					annotationEditorHighlightColors:
						'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F'
				});
				linkService.setViewer(viewer);
				bus.on('pagesinit', () => {
					if (!viewer) return;
					const view = readViews()[path];
					viewer.currentScaleValue = view?.scale || 'page-width';
					if (view && view.page > 1 && view.page <= viewer.pagesCount) viewer.currentPageNumber = view.page;
					restored = true;
				});
				bus.on('pagechanging', (e: { pageNumber: number }) => {
					page = e.pageNumber;
					rememberView();
				});
				bus.on('scalechanging', rememberView);
				bus.on('annotationeditormodechanged', (e: { mode: number }) => (mode = e.mode));
				type Count = { matchesCount: { current: number; total: number } };
				bus.on('updatefindmatchescount', (e: Count) => (found = e.matchesCount));
				bus.on('updatefindcontrolstate', (e: Count & { state: number }) => {
					// PENDING (3) repeats the old count while pdf.js searches.
					if (e.state !== 3) found = e.matchesCount;
				});

				task = lib.getDocument({
					url: `${assetUrl(path)}?v=${encodeURIComponent(version ?? '')}`,
					rangeChunkSize: 256 * 1024,
					BinaryDataFactory,
					enableHWA: true
				});
				const loaded = await task.promise;
				if (gone) return;
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
			// Closing or switching files still writes pending annotations
			// (saveOnClose), then frees the worker's copy of the document.
			// A PDF still loading stops downloading right away.
			const last = task;
			closed = true;
			if (!doc) void last?.destroy();
			void saveOnClose().finally(() => {
				viewer?.cleanup();
				void last?.destroy();
			});
		};
	});
</script>

<!-- Catches Ctrl+F from anywhere inside the pane. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="pane" class:dark aria-label="PDF {name}" onkeydown={paneKey}>
	<div class="bar">
		<span class="material-symbols-outlined kind">picture_as_pdf</span>
		<span class="name" title={path}>{name}</span>
		{#if pages}
			{#if jumping}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="jump"
					type="number"
					min="1"
					max={pages}
					value={page}
					autofocus
					onfocus={(e) => e.currentTarget.select()}
					onblur={() => (jumping = false)}
					onkeydown={(e) => {
						if (e.key === 'Enter') jump(e.currentTarget.value);
						else if (e.key === 'Escape') {
							e.stopPropagation();
							jumping = false;
						}
					}}
				/>
				<span class="pages">/ {pages}</span>
			{:else}
				<button class="pages" title="Go to page" onclick={() => (jumping = true)}>{page} / {pages}</button>
			{/if}
		{/if}
		<span class="save" class:bad={saveState === 'failed'}>
			{saveState === 'saving' ? 'Saving' : saveState === 'failed' ? 'Save failed, retrying' : ''}
		</span>
		{#if copy}
			<span class="save bad" title="This PDF changed elsewhere; your annotations save to {copy}">
				Saving to {copy.split('/').pop()}
			</span>
		{/if}
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
		<button class="btn" class:on={finding} title="Find (Ctrl+F)" onclick={() => (finding ? closeFind() : openFind())}>
			<span class="material-symbols-outlined">search</span>
		</button>
		<button class="btn" class:on={dark} title={dark ? 'Light pages' : 'Dark pages'} onclick={toggleDark}>
			<span class="material-symbols-outlined">dark_mode</span>
		</button>
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
	{#if finding}
		<div class="find">
			<span class="material-symbols-outlined">search</span>
			<input
				bind:this={findInput}
				bind:value={query}
				placeholder="Find in PDF"
				oninput={() => (query ? find('') : (found = null))}
				onkeydown={(e) => {
					if (e.key === 'Enter' && query) find('again', e.shiftKey);
					else if (e.key === 'Escape') {
						e.stopPropagation();
						closeFind();
					}
				}}
			/>
			{#if found && query}
				<span class="count">{found.total ? `${found.current} of ${found.total}` : 'No matches'}</span>
			{/if}
			<button class="btn" title="Previous match (Shift+Enter)" disabled={!query} onclick={() => find('again', true)}>
				<span class="material-symbols-outlined">keyboard_arrow_up</span>
			</button>
			<button class="btn" title="Next match (Enter)" disabled={!query} onclick={() => find('again')}>
				<span class="material-symbols-outlined">keyboard_arrow_down</span>
			</button>
			<button class="btn" title="Close find (Esc)" onclick={closeFind}>
				<span class="material-symbols-outlined">close</span>
			</button>
		</div>
	{/if}
	<div class="stage">
		{#if failed}
			<p class="error">{failed}</p>
		{/if}
		<div class="scroller" tabindex="-1" bind:this={container}>
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
		padding: 0;
		border: 0;
		background: none;
		color: var(--text-3);
		font: var(--fs) var(--font-mono);
		white-space: nowrap;
	}
	button.pages {
		cursor: pointer;
	}
	button.pages:hover {
		color: var(--text);
	}
	.jump {
		width: 5ch;
		margin-left: 10px;
		padding: 1px 4px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-sm);
		background: var(--panel);
		color: var(--text);
		font: var(--fs) var(--font-mono);
		appearance: textfield;
	}
	.jump + .pages {
		margin-left: 4px;
	}
	.find {
		height: 38px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 8px 0 14px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
		background: var(--bg);
		color: var(--text-3);
	}
	.find > .material-symbols-outlined {
		font-size: 18px;
		margin-right: 6px;
	}
	.find input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: none;
		color: var(--text);
		font: inherit;
	}
	.count {
		margin: 0 6px;
		font: var(--fs) var(--font-mono);
		white-space: nowrap;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* A plain filter on the rendered page; text, links and highlights sit
	   in layers above it and keep their colors. */
	.dark :global(.page canvas) {
		filter: invert(0.9) hue-rotate(180deg);
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
		outline: none;
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
