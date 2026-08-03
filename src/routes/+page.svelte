<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import CodeEditor from '$lib/editor/CodeEditor.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import { activePath, loadTree, loadNote, scheduleSave, flushSave, openTab } from '$lib/stores/vault';

	const MIN_SIDEBAR = 180;
	const MAX_SIDEBAR = 520;

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

	let sidebarWidth = $state(240);
	let collapsed = $state(false);
	let resizing = $state(false);
	let dividerHover = $state(false);
	let paletteOpen = $state(false);
	let imagePreview = $state<string | null>(null);
	let zoom = $state(100);

	const MIN_ZOOM = 10;
	const MAX_ZOOM = 500;
	const ZOOM_STEP = 10;

	onMount(() => {
		const saved = Number(localStorage.getItem('scrinium:sidebarWidth'));
		if (Number.isFinite(saved) && saved >= MIN_SIDEBAR) sidebarWidth = saved;
		collapsed = localStorage.getItem('scrinium:sidebarCollapsed') === '1';
		loadTree();

		const key = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				paletteOpen = !paletteOpen;
			} else if (e.key === 'Escape' && paletteOpen) {
				paletteOpen = false;
			} else if (e.key === 'Escape' && imagePreview) {
				imagePreview = null;
			}
		};
		window.addEventListener('keydown', key);

		const move = (e: PointerEvent) => {
			if (!resizing) return;
			sidebarWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX));
		};
		const up = () => {
			if (!resizing) return;
			resizing = false;
			localStorage.setItem('scrinium:sidebarWidth', String(sidebarWidth));
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);

		// Best-effort: save any pending edits if the tab is closed mid-debounce.
		window.addEventListener('pagehide', () => {
			void flushSave();
		});
		return () => {
			window.removeEventListener('keydown', key);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
	});

	function toggleCollapse() {
		collapsed = !collapsed;
		localStorage.setItem('scrinium:sidebarCollapsed', collapsed ? '1' : '0');
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
		if (path) scheduleSave(path, newContent);
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
		<Sidebar
			onSelect={openNote}
			onOpenAsset={(path) => {
				imagePreview = path;
				zoom = 100;
			}}
		/>
	</div>
	<div
		class="divider"
		class:active={dividerHover || resizing}
		role="separator"
		aria-orientation="vertical"
		onpointerdown={(e) => {
			e.preventDefault();
			collapsed = false;
			resizing = true;
		}}
		ondblclick={toggleCollapse}
		onpointerenter={() => (dividerHover = true)}
		onpointerleave={() => (dividerHover = false)}
	></div>
	<div class="main">
		<TopBar path={$activePath} />
		<TabBar activePath={$activePath} onActivate={openNote} />
		{#if $activePath}
			<CodeEditor bind:this={editorRef} value={currentContent} {onChange} notePath={$activePath} />
		{:else}
			<div class="empty">Select a note, or create one from the sidebar.</div>
		{/if}
	</div>
</div>

{#if paletteOpen}
	<CommandPalette
		onSelect={openNote}
		onClose={() => (paletteOpen = false)}
		onToggleSidebar={toggleCollapse}
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
		flex-shrink: 0;
		height: 100vh;
		overflow: hidden;
		transition: width 0.18s ease;
	}
	.sidebar-wrap.resizing {
		transition: none;
	}
	.divider {
		width: 6px;
		flex-shrink: 0;
		cursor: col-resize;
		background: #24262f;
		position: relative;
	}
	.divider::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 2px;
		width: 2px;
		background: transparent;
	}
	.divider:hover::after,
	.divider.active::after {
		background: #4f7cff;
	}
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #6b6e7a;
		font-family: system-ui, sans-serif;
		font-size: 0.9rem;
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
		background: rgba(20, 21, 26, 0.85);
		border: 1px solid #2a2d38;
		border-radius: 8px;
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
		border-radius: 6px;
		color: #c9cbd6;
		font-size: 1rem;
		cursor: pointer;
	}
	.zoom-btn:hover {
		background: #2e313d;
	}
	.zoom-btn.close:hover {
		background: #3a2226;
		color: #ff6b6b;
	}
	.zoom-sep {
		width: 1px;
		height: 18px;
		background: #2a2d38;
		margin: 0 0.1rem;
	}
	.zoom-pct {
		min-width: 52px;
		background: none;
		border: none;
		color: #e6e6e6;
		font-size: 0.8rem;
		text-align: center;
		cursor: pointer;
		padding: 0.15rem 0.25rem;
		border-radius: 6px;
	}
	.zoom-pct:hover {
		background: #2e313d;
	}
</style>
