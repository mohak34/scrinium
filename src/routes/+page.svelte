<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Backlinks from '$lib/components/Backlinks.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import CodeEditor from '$lib/editor/CodeEditor.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import {
		activePath,
		loadTree,
		loadNote,
		scheduleSave,
		flushSave,
		openTab,
		scheduleTitleSync,
		externalContentUpdate
	} from '$lib/stores/vault';

	let editorRef = $state<CodeEditor>();
	let currentContent = $state('');
	let lastLoadedPath = $state<string | null>('');

	// Loading the active note's content happens here so that ANY activePath
	// change - opening a note, or closeTab switching to a neighbour - reloads
	// the right content. Sidebar/command palette/clicking a tab only ever need
	// to register the tab and set the active path.
	$effect(() => {
		const path = $activePath;
		if (path === lastLoadedPath) return;
		lastLoadedPath = path;
		if (!path) {
			currentContent = '';
			return;
		}
		void (async () => {
			await flushSave();
			const content = await loadNote(path);
			if ($activePath === path) {
				currentContent = content;
				editorRef?.setDoc(content);
			}
		})();
	});

	// When a file rename syncs its H1 title (filename -> title), push the
	// new content into the editor without treating it as a user edit.
	$effect(() => {
		const upd = $externalContentUpdate;
		if (!upd) return;
		if (upd.path === $activePath) {
			currentContent = upd.content;
			editorRef?.setDoc(upd.content);
			externalContentUpdate.set(null);
		}
	});

	let collapsed = $state(false);
	let rightCollapsed = $state(false);
	let sidebarWidth = $state(260);
	let resizing = $state(false);
	let paletteOpen = $state(false);
	let imagePreview = $state<string | null>(null);
	let zoom = $state(100);

	const MIN_ZOOM = 10;
	const MAX_ZOOM = 500;
	const ZOOM_STEP = 10;

	onMount(() => {
		collapsed = localStorage.getItem('scrinium:sidebarCollapsed') === '1';
		rightCollapsed = localStorage.getItem('scrinium:rightCollapsed') === '1';
		const savedWidth = Number(localStorage.getItem('scrinium:sidebarWidth'));
		if (Number.isFinite(savedWidth) && savedWidth >= 180 && savedWidth <= 480) {
			sidebarWidth = savedWidth;
		}
		loadTree();

		const key = (e: KeyboardEvent) => {
			// App-wide find: CodeMirror only sees keys while its editor has
			// focus, so a bare Mod+F anywhere else would hit the browser's
			// native find. Route it to the editor's search panel instead when
			// a note is open; with no note open the browser find is the only
			// option, so leave the default alone.
			if (
				(e.metaKey || e.ctrlKey) &&
				!e.shiftKey &&
				!e.altKey &&
				e.key.toLowerCase() === 'f' &&
				get(activePath)
			) {
				e.preventDefault();
				editorRef?.runCommand('find');
			} else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				paletteOpen = !paletteOpen;
			} else if ((e.metaKey || e.ctrlKey) && e.key === '/') {
				// Toggle the left sidebar from anywhere, editor included.
				e.preventDefault();
				toggleCollapse();
			} else if (e.key === 'Escape' && paletteOpen) {
				paletteOpen = false;
			} else if (e.key === 'Escape' && imagePreview) {
				imagePreview = null;
			}
		};
		window.addEventListener('keydown', key);

		// Best-effort: save any pending edits if the tab is closed mid-debounce.
		window.addEventListener('pagehide', () => {
			void flushSave();
		});
		return () => {
			window.removeEventListener('keydown', key);
		};
	});

	function toggleCollapse() {
		collapsed = !collapsed;
		localStorage.setItem('scrinium:sidebarCollapsed', collapsed ? '1' : '0');
	}

	function toggleRightCollapse() {
		rightCollapsed = !rightCollapsed;
		localStorage.setItem('scrinium:rightCollapsed', rightCollapsed ? '1' : '0');
	}

	// Drag the sidebar's right edge to resize. Double-click resets to the
	// default width. Multi-clicks never start a drag (detail > 1).
	function startSidebarResize(e: MouseEvent) {
		if (e.detail > 1 || collapsed) return;
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startW = sidebarWidth;
		const move = (ev: MouseEvent) => {
			sidebarWidth = Math.min(480, Math.max(180, startW + ev.clientX - startX));
		};
		const up = () => {
			resizing = false;
			localStorage.setItem('scrinium:sidebarWidth', String(sidebarWidth));
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	}

	function resetSidebarWidth() {
		sidebarWidth = 260;
		localStorage.setItem('scrinium:sidebarWidth', '260');
	}

	// Keyboard resize on the focused handle: arrows step, Home resets.
	function resizeKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 20 : 10;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			const delta = e.key === 'ArrowRight' ? step : -step;
			sidebarWidth = Math.min(480, Math.max(180, sidebarWidth + delta));
			localStorage.setItem('scrinium:sidebarWidth', String(sidebarWidth));
		} else if (e.key === 'Home') {
			e.preventDefault();
			resetSidebarWidth();
		}
	}

	async function openNote(path: string) {
		// Finish saving the current note before swapping, so the debounce never
		// drops edits made right before switching.
		await flushSave();
		openTab(path);
	}

	function onChange(newContent: string) {
		currentContent = newContent;
		const path = get(activePath);
		if (path) {
			scheduleSave(path, newContent);
			scheduleTitleSync(path, newContent);
		}
	}

	// The asset API is auth-gated; the preview <img> authenticates via the
	// same-origin session cookie like everything else.
	function assetUrl(path: string) {
		return '/api/assets/' + path.split('/').map(encodeURIComponent).join('/');
	}
</script>

<div class="layout">
	<div
		class="sidebar-wrap"
		class:collapsed={collapsed}
		class:resizing={resizing}
		style="width: {collapsed ? 0 : sidebarWidth}px"
	>
		{#if !collapsed}
		<Sidebar
			onSelect={openNote}
			onToggleCollapse={toggleCollapse}
			onOpenAsset={(path) => {
				imagePreview = path;
				zoom = 100;
			}}
		/>
			<div
				class="resize-handle"
				role="slider"
				tabindex="0"
				aria-label="Sidebar width"
				aria-valuemin="180"
				aria-valuemax="480"
				aria-valuenow={sidebarWidth}
				onmousedown={startSidebarResize}
				ondblclick={resetSidebarWidth}
				onkeydown={resizeKey}
				title="Drag to resize, double-click to reset"
			></div>
		{/if}
	</div>
	<div class="main">
		<TabBar
			activePath={$activePath}
			onActivate={openNote}
			sidebarCollapsed={collapsed}
			onToggleSidebar={toggleCollapse}
		/>
		<div class="editor-scroll">
			{#if $activePath}
				<CodeEditor
					bind:this={editorRef}
					value={currentContent}
					{onChange}
					notePath={$activePath}
				/>
			{:else}
				<div class="empty">Select a note, or create one from the sidebar.</div>
			{/if}
		</div>
	</div>
	{#if $activePath && !rightCollapsed}
		<aside class="rightbar" aria-label="Right sidebar">
			<Backlinks onSelect={openNote} onClose={toggleRightCollapse} />
		</aside>
	{/if}
</div>

{#if paletteOpen}
	<CommandPalette
		onSelect={openNote}
		onClose={() => (paletteOpen = false)}
		onToggleSidebar={toggleCollapse}
		onToggleRightSidebar={toggleRightCollapse}
		onCommand={(cmd) => editorRef?.runCommand(cmd)}
	/>
{/if}

{#if imagePreview}
	<div class="img-overlay" role="presentation">
		<div class="zoom-controls">
			<button
				class="zoom-btn"
				title="Zoom out"
				onclick={() => (zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP))}
			>
				−
			</button>
			<button class="zoom-pct" title="Reset zoom" onclick={() => (zoom = 100)}>
				{zoom}%
			</button>
			<button
				class="zoom-btn"
				title="Zoom in"
				onclick={() => (zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP))}
			>
				+
			</button>
			<span class="zoom-sep"></span>
			<button class="zoom-btn close" title="Close (Esc)" onclick={() => (imagePreview = null)}>
				✕
			</button>
		</div>
		<div class="img-stage">
			<img
				class="img-preview"
				style="transform: scale({zoom / 100})"
				src={assetUrl(imagePreview)}
				alt={imagePreview}
			/>
		</div>
	</div>
{/if}

<style>
	.layout {
		display: flex;
		height: 100vh;
	}
	.sidebar-wrap {
		width: var(--sidebar-width);
		flex-shrink: 0;
		height: 100vh;
		overflow: hidden;
		position: relative;
		transition: width 0.18s ease;
	}
	.sidebar-wrap.collapsed {
		width: 0;
	}
	.sidebar-wrap.resizing {
		transition: none;
	}
	.resize-handle {
		position: absolute;
		top: 0;
		right: -3px;
		width: 7px;
		height: 100%;
		cursor: col-resize;
		z-index: 10;
		background: transparent;
	}
	.resize-handle:hover,
	.resize-handle:focus-visible {
		background: rgba(181, 196, 255, 0.25);
		outline: none;
	}
	.rightbar {
		width: 260px;
		flex-shrink: 0;
		height: 100vh;
		overflow: hidden;
		background: #15161c;
		border-left: 1px solid var(--border-default);
		display: flex;
		flex-direction: column;
	}
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.editor-scroll {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		padding: 0 var(--gutter);
	}
	.empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--outline);
		font-size: var(--font-ui-small);
	}
	.img-overlay {
		position: fixed;
		inset: 0;
		z-index: 950;
		background: rgba(0, 0, 0, 0.75);
		display: grid;
		overflow: auto;
	}
	.img-stage {
		display: flex;
		align-items: center;
		justify-content: center;
		margin: auto;
		max-width: 100%;
		max-height: 100%;
		padding: 3.5rem 1.5rem 1.5rem;
	}
	.img-preview {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: 6px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
	}
	.zoom-controls {
		position: fixed;
		top: 1rem;
		right: 1rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		padding: 0.3rem;
		z-index: 1;
	}
	.zoom-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		border-radius: var(--radius);
		color: var(--on-surface);
		font-size: 1rem;
		cursor: pointer;
	}
	.zoom-btn:hover {
		background: var(--surface-container-high);
	}
	.zoom-btn.close:hover {
		background: var(--error-container);
		color: var(--error);
	}
	.zoom-sep {
		width: 1px;
		height: 18px;
		background: var(--border-default);
		margin: 0 0.1rem;
	}
	.zoom-pct {
		min-width: 52px;
		background: none;
		border: none;
		color: var(--on-surface);
		font-size: 0.8rem;
		text-align: center;
		cursor: pointer;
		padding: 0.15rem 0.25rem;
		border-radius: var(--radius);
	}
	.zoom-pct:hover {
		background: var(--surface-container-high);
	}
</style>
