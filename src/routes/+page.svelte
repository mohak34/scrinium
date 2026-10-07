<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Backlinks from '$lib/components/Backlinks.svelte';
	import FileInfo from '$lib/components/FileInfo.svelte';
	import Outline from '$lib/components/Outline.svelte';
	import Tags from '$lib/components/Tags.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import NoteBar from '$lib/components/NoteBar.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import NoteTasks from '$lib/components/NoteTasks.svelte';
	import CodeEditor from '$lib/editor/CodeEditor.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import {
		activePath,
		loadTree,
		openTabs,
		scheduleSave,
		flushSave,
		openTab,
		closeTab,
		togglePin,
		scheduleTitleSync,
		attachEditor,
		shownNote,
		showNote,
		hideNote
	} from '$lib/stores/vault';
	import { settings } from '$lib/stores/settings';
	import { createRequest, focusSearchRequest } from '$lib/stores/actions';
	import ShortcutHelp from '$lib/components/ShortcutHelp.svelte';

	let editorRef = $state<CodeEditor>();
	let currentContent = $state('');
	let lastLoadedPath = $state<string | null>('');

	onMount(() =>
		attachEditor({
			show(path, content) {
				if (get(activePath) !== path) return false;
				currentContent = content;
				editorRef?.setDoc(content, true);
				return true;
			},
			read: () => currentContent,
			write(content) {
				editorRef?.setDoc(content);
				onChange(content);
			}
		})
	);

	// Loading the active note's content happens here so that ANY activePath
	// change - opening a note, or closeTab switching to a neighbour - reloads
	// the right content. Sidebar/command palette/clicking a tab only ever need
	// to register the tab and set the active path.
	$effect(() => {
		const path = $activePath;
		if (path === lastLoadedPath) return;
		lastLoadedPath = path;
		// The editor already holds this note: it was renamed or moved (same
		// note, new path), or the user came back before another note loaded.
		// Reloading would jump the cursor and drop keystrokes.
		if (path && path === shownNote()) return;
		if (!path) {
			hideNote();
			currentContent = '';
			return;
		}
		void showNote(path);
	});

	let collapsed = $state(false);
	let rightCollapsed = $state(false);
	let sidebarWidth = $state(260);
	let resizing = $state(false);
	let paletteOpen = $state(false);
	let helpOpen = $state(false);
	let leaderPending = $state(false);
	let leaderTimer: ReturnType<typeof setTimeout> | undefined;
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
			// Vim-style keys (? help, / search, [ ] tabs). Plain keys with no
			// modifiers never clash with browser shortcuts, and they only
			// fire outside text inputs so typing is never hijacked.
			if (e.key === 'Escape' && helpOpen) {
				helpOpen = false;
				return;
			}
			if (leaderPending) {
				clearLeader();
				// A modifier combo aborts the leader and falls through to the
				// normal handling below; Esc just cancels.
				if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Escape') return;
				const t = e.target as HTMLElement | null;
				const typing = !!t?.closest?.(
					'input, textarea, select, [contenteditable="true"], .cm-content, .cm-editor'
				);
				if (!typing && !paletteOpen && !imagePreview && !helpOpen) {
					e.preventDefault();
					runLeader(e.key);
				}
				return;
			}
			if (
				get(settings).editor.vimMotions &&
				!e.metaKey &&
				!e.ctrlKey &&
				!e.altKey &&
				(e.key === '?' ||
					e.key === '/' ||
					e.key === '[' ||
					e.key === ']' ||
					e.key === ' ')
			) {
				const t = e.target as HTMLElement | null;
				const typing = !!t?.closest?.(
					'input, textarea, select, [contenteditable="true"], .cm-content, .cm-editor'
				);
				// Space keeps its native behaviour on controls (buttons use
				// it to activate); the leader only starts from dead areas.
				const onControl = e.key === ' ' && !!t?.closest?.('button, a, [role="button"]');
				if (!typing && !onControl && !paletteOpen && !imagePreview && !helpOpen) {
					e.preventDefault();
					if (e.key === '?') helpOpen = true;
					else if (e.key === '/') focusSearch();
					else if (e.key === ' ') startLeader();
					else stepTab(e.key === ']' ? 1 : -1);
					return;
				}
			}
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
			} else if (e.key === 'Escape' && (editorRef?.exitPreview() ?? false)) {
				// Full preview was on with the editor blurred: marks are back
				// and focus is in the editor. Empty body by design.
			}
		};
		window.addEventListener('keydown', key);

		// Best-effort: save any pending edits if the tab is closed mid-debounce.
		window.addEventListener('pagehide', () => {
			void flushSave(true);
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

	// Focus the sidebar search box. If the sidebar is collapsed the tree
	// remounts, so bump the focus request again once it exists.
	function focusSearch() {
		if (collapsed) {
			toggleCollapse();
			setTimeout(() => focusSearchRequest.update((n) => n + 1), 80);
		} else {
			focusSearchRequest.update((n) => n + 1);
		}
	}

	// Cycle open tabs; wraps around. No browser binding uses plain [ ].
	function stepTab(dir: 1 | -1) {
		const tabs = get(openTabs);
		if (!tabs.length) return;
		const cur = get(activePath);
		const idx = cur ? tabs.indexOf(cur) : -1;
		const next = tabs[(idx + dir + tabs.length) % tabs.length] ?? tabs[0];
		if (next && next !== cur) void openNote(next);
	}

	// Space leader: two-key app commands (Space then a letter). Times out
	// after a second so a stray Space never leaves the app armed.
	function startLeader() {
		leaderPending = true;
		clearTimeout(leaderTimer);
		leaderTimer = setTimeout(() => (leaderPending = false), 1000);
	}

	function clearLeader() {
		leaderPending = false;
		clearTimeout(leaderTimer);
	}

	// Ask the sidebar for an inline create input. The request value persists
	// until the sidebar consumes it, so this works while collapsed too.
	function newEntry(kind: 'note' | 'folder') {
		if (collapsed) toggleCollapse();
		createRequest.set({ parent: null, kind });
	}

	function runLeader(key: string) {
		switch (key) {
			case ' ':
			case 'p':
				paletteOpen = true;
				break;
			case 'n':
				newEntry('note');
				break;
			case 'N':
				newEntry('folder');
				break;
			case 's':
				toggleCollapse();
				break;
			case 'r':
				toggleRightCollapse();
				break;
			case 'e': {
				const path = get(activePath);
				if (path) editorRef?.focus();
				break;
			}
			case 'f':
				focusSearch();
				break;
			case 'x': {
				const path = get(activePath);
				if (path) closeTab(path);
				break;
			}
			case 'P': {
				const path = get(activePath);
				if (path) togglePin(path);
				break;
			}
		}
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
		const path = shownNote();
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
			onNewNote={() => newEntry('note')}
		/>
		{#if $activePath}
			<NoteBar
				path={$activePath}
				rightOpen={!rightCollapsed}
				onTogglePreview={() => editorRef?.togglePreview()}
				onToggleRight={toggleRightCollapse}
			/>
		{/if}
		<div class="editor-scroll">
			{#if $activePath}
				<CodeEditor
					bind:this={editorRef}
					value={currentContent}
					{onChange}
					notePath={$activePath}
				/>
			{:else}
				<div class="empty">
					<span class="material-symbols-outlined">description</span>
					<p>Open a note from the sidebar, or start a new one.</p>
					<button class="new" onclick={() => newEntry('note')}>
						<span class="material-symbols-outlined">edit_square</span>New note
					</button>
				</div>
			{/if}
		</div>
		{#if $activePath}
			<StatusBar content={currentContent} />
		{/if}
	</div>
	{#if $activePath && !rightCollapsed}
		<aside class="rightbar" aria-label="Note details">
			<div class="rhead">
				<span class="rtitle">{($activePath.split('/').pop() ?? '').replace(/\.md$/, '')}</span>
				<button class="rclose" title="Hide panel (Space r)" onclick={toggleRightCollapse}>
					<span class="material-symbols-outlined">close</span>
				</button>
			</div>
			<div class="rscroll">
				<Outline content={currentContent} onJump={(line) => editorRef?.gotoLine(line)} />
				<Backlinks onSelect={openNote} />
				<NoteTasks />
				<Tags content={currentContent} />
				<FileInfo content={currentContent} />
			</div>
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

{#if helpOpen}
	<ShortcutHelp onClose={() => (helpOpen = false)} />
{/if}

{#if leaderPending}
	<div class="leader" role="status">Space…</div>
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
		background: var(--accent-dim);
		outline: none;
	}
	.rightbar {
		width: 290px;
		flex-shrink: 0;
		height: 100vh;
		background: var(--panel);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
	}
	.rhead {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 40px;
		padding: 0 8px 0 16px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}
	.rtitle {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rclose {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.rclose:hover {
		background: var(--hover);
		color: var(--text);
	}
	.rscroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 0 24px;
	}
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg);
	}
	.editor-scroll {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.empty {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--text-3);
	}
	.empty > .material-symbols-outlined {
		font-size: 36px;
		color: var(--text-4);
	}
	.empty p {
		margin: 0;
	}
	.new {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		margin-top: 6px;
		padding: 0 14px 0 12px;
		border: none;
		border-radius: var(--r-md);
		background: var(--accent-fill);
		color: var(--on-accent);
		font: 600 var(--fs) var(--font-ui);
		cursor: pointer;
	}
	.new:hover {
		background: var(--accent-fill-hi);
	}
	.leader {
		position: fixed;
		left: 12px;
		bottom: 12px;
		z-index: 940;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius);
		box-shadow: var(--shadow-pop);
		color: var(--on-surface-variant);
		font-family: var(--font-mono);
		font-size: var(--font-ui-small);
		padding: 4px 10px;
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
