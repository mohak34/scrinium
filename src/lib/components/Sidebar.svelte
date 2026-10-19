<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { settings } from '$lib/stores/settings';
	import FileTree from './FileTree.svelte';
	import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
	import SearchBox from './SearchBox.svelte';
	import {
		tree,
		pinnedPaths,
		globalPins,
		togglePin,
		setPinGlobal,
		activePath,
		createNote,
		createFolder,
		renameNote,
		syncFilenameToTitle,
		deletePath,
		archivePath,
		movePath,
		movePin,
		downloadNote,
		flushSave,
		loadTree,
		type VaultEntry
	} from '$lib/stores/vault';
	import {
		expandDir,
		renameDir,
		parentDirOf,
		toggleDir,
		collapsedDirs
	} from '$lib/stores/filetree';
	import {
		tasks,
		loadTasks,
		projects,
		loadProjects,
		createProject,
		removeProject,
		newProjectOpen
	} from '$lib/stores/tasks';
	import { projectOf, projectLabel, boardHref, type ProjectKey, type ProjectView } from '$lib/projects';
	import { drag, beginDrag, type DragSource, type DropTarget } from './sidebarDrag';
	import { goto } from '$app/navigation';
	import { createRequest, renameRequest } from '$lib/stores/actions';
	import AppSwitcher from './AppSwitcher.svelte';
	import AppActions from './AppActions.svelte';

	interface Props {
		onSelect: (path: string) => void;
		onOpenAsset: (path: string) => void;
		onToggleCollapse: () => void;
	}
	let { onSelect, onOpenAsset, onToggleCollapse }: Props = $props();

	// What a right-click (or the project switcher) opened the menu on. A pin
	// row's note is not in the tree, so there is no inline rename for it;
	// rename by the title.
	type MenuOn =
		| { kind: 'blank' }
		| { kind: 'entry'; entry: VaultEntry; pinRow: boolean }
		| { kind: 'section'; key: ProjectKey }
		| { kind: 'view' };
	let menu = $state<({ x: number; y: number } & MenuOn) | null>(null);
	let createTarget = $state<{ parent: string | null; kind: 'note' | 'folder' } | null>(null);
	let renameTarget = $state<{ path: string } | null>(null);
	let treeEl = $state<HTMLDivElement>();

	// The sidebar shows every project as a section, or one project. Kept per
	// browser like pins and collapsed folders.
	const VIEW_KEY = 'scrinium:projectView';
	let view = $state<ProjectView>('all');
	function setView(v: ProjectView) {
		view = v;
		localStorage.setItem(VIEW_KEY, JSON.stringify(v));
	}

	// The command palette signals "create a note/folder here" through the shared
	// createRequest store; hand it over to the inline create inputs.
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
			if (saved && typeof saved === 'object' && (saved.project === null || typeof saved.project === 'string'))
				view = { project: saved.project };
		} catch {
			// a bad stored view falls back to All
		}
		void loadProjects();
		if ($tasks.length === 0) void loadTasks();
		const unsubCreate = createRequest.subscribe((req) => {
			if (req) {
				startCreate(req.parent ?? homeDir, req.kind);
				createRequest.set(null);
			}
		});
		// The top bar requests an inline rename; expand its ancestors so the
		// rename input is visible, then hand it to the tree.
		const unsubRename = renameRequest.subscribe((req) => {
			if (!req) return;
			renameRequest.set(null);
			let parent = parentDirOf(req.path);
			while (parent) {
				expandDir(parent);
				parent = parentDirOf(parent);
			}
			expandDir(projectOf(req.path, projectSet) ?? '');
			renameTarget = { path: req.path };
		});
		return () => {
			unsubCreate();
			unsubRename();
		};
	});

	// Top-level project folders get their own sections; everything else is
	// Quotidian. A section folds under its folder path ("" for Quotidian) in
	// collapsedDirs, so a rename keeps it folded.
	const projectSet = $derived(new Set($projects.map((p) => p.path)));
	const isProjectDir = (e: VaultEntry) => e.type === 'directory' && projectSet.has(e.path);
	const sections = $derived<{ key: ProjectKey; entries: VaultEntry[] }[]>([
		{ key: null, entries: $tree.filter((e) => !isProjectDir(e)) },
		...$tree.filter(isProjectDir).map((e) => ({ key: e.path, entries: e.children ?? [] }))
	]);
	// A shown project that is gone (removed, renamed elsewhere) falls back to All.
	const current = $derived.by((): ProjectView => {
		const v = view;
		return v !== 'all' && sections.some((s) => s.key === v.project) ? v : 'all';
	});
	const shownSections = $derived(
		current === 'all' ? sections : sections.filter((s) => s.key === current.project)
	);
	// Where the header's New note / New folder land.
	const homeDir = $derived(current === 'all' ? null : current.project);
	const foldKey = (key: ProjectKey) => key ?? '';

	const openTasks = $derived.by(() => {
		const counts = new Map<ProjectKey, number>();
		for (const t of $tasks) if (t.status !== 'done') counts.set(t.project, (counts.get(t.project) ?? 0) + 1);
		return counts;
	});

	function startCreate(parent: string | null, kind: 'note' | 'folder') {
		const key = parent === null ? null : projectOf(parent + '/', projectSet);
		expandDir(foldKey(key));
		if (parent && parent !== key) expandDir(parent);
		createTarget = { parent, kind };
	}

	async function openBoard(v: ProjectView) {
		await flushSave();
		await goto(boardHref(v));
	}

	async function dropProject(path: string) {
		if (!confirm(`Remove project "${path}"? Its folder and notes stay, its tasks move to Quotidian.`)) return;
		await removeProject(path);
	}

	async function makeProject(path: string) {
		const row = await createProject(path);
		if (typeof row === 'string') alert(row);
		else await loadTree();
	}

	function sanitizeName(raw: string, kind: 'note' | 'folder' | 'file'): string | null {
		let name = raw.trim().replace(/[\\/:*?"<>|]/g, '');
		if (!name || name === '.' || name === '..' || name.startsWith('.')) return null;
		if (kind === 'note' && !name.endsWith('.md')) name += '.md';
		return name;
	}

	function joinPath(parent: string | null, name: string) {
		return parent ? `${parent}/${name}` : name;
	}

	function pathExists(target: string, entries: typeof $tree): boolean {
		for (const e of entries) {
			if (e.path === target) return true;
			if (e.children && pathExists(target, e.children)) return true;
		}
		return false;
	}

	function uniquePath(parent: string | null, name: string): string {
		let candidate = joinPath(parent, name);
		if (!pathExists(candidate, $tree)) return candidate;
		const ext = name.endsWith('.md') ? '.md' : '';
		const base = ext ? name.slice(0, -3) : name;
		for (let i = 1; i < 100; i++) {
			const nextName = `${base} (${i})${ext}`;
			candidate = joinPath(parent, nextName);
			if (!pathExists(candidate, $tree)) return candidate;
		}
		return candidate;
	}

	async function commitCreate(parent: string | null, kind: 'note' | 'folder', rawName: string) {
		const name = sanitizeName(rawName, kind);
		if (!name) {
			createTarget = null;
			return;
		}
		const path = uniquePath(parent, name);
		if (kind === 'folder') {
			if (parent) expandDir(parent);
			await createFolder(path);
		} else {
			await createNote(path);
			onSelect(path);
		}
		createTarget = null;
	}

	async function commitRename(path: string, rawName: string) {
		// A markdown note keeps its `Path.md` extension even if the user types a
		// bare name; folders and assets keep whatever they were given.
		const kind = path.endsWith('.md') ? 'note' : 'file';
		const name = sanitizeName(rawName, kind);
		if (name) {
			const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
			const newPath = joinPath(parent, name);
			if (newPath !== path) {
				const wasProject = projectSet.has(path);
				const ok = await renameNote(path, newPath);
				if (ok) {
					renameDir(path, newPath);
					await syncFilenameToTitle(path, newPath);
					// The server moved the project and its tasks with the folder.
					if (wasProject) {
						await Promise.all([loadProjects(), loadTasks()]);
						if (view !== 'all' && view.project === path) setView({ project: newPath });
					}
				}
			}
		}
		renameTarget = null;
	}

	function onEntryContextMenu(entry: VaultEntry, x: number, y: number) {
		menu = { x, y, kind: 'entry', entry, pinRow: false };
	}

	// Keyboard-first tree navigation. Arrows always work; h/j/k/l are vim
	// motions gated behind the vim setting. Only active when focus sits on
	// a tree entry, never inside rename/create inputs.
	function treeKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('input, textarea')) return;
		const entryEl = target?.closest?.('[data-tree-entry]') as HTMLElement | null;
		if (!entryEl || !treeEl) return;
		const vimOn = get(settings).editor.vimMotions;
		const entries = Array.from(treeEl.querySelectorAll<HTMLElement>('[data-tree-entry]')).filter(
			(el) => el.tabIndex >= 0
		);
		const idx = entries.indexOf(entryEl);
		if (idx === -1) return;
		const path = entryEl.dataset.path ?? '';
		const isDir = entryEl.dataset.type === 'directory';
		if (e.key === 'ArrowDown' || (vimOn && e.key === 'j')) {
			e.preventDefault();
			entries[(idx + 1) % entries.length]?.focus();
		} else if (e.key === 'ArrowUp' || (vimOn && e.key === 'k')) {
			e.preventDefault();
			entries[(idx - 1 + entries.length) % entries.length]?.focus();
		} else if (vimOn && e.key === 'l') {
			e.preventDefault();
			if (isDir && get(collapsedDirs).has(path)) toggleDir(path);
			else if (isDir) {
				// An expanded dir's first child renders directly below it.
				const next = entries[idx + 1];
				if (next && (next.dataset.path ?? '').startsWith(path + '/')) next.focus();
			}
		} else if (vimOn && e.key === 'h') {
			e.preventDefault();
			if (isDir && !get(collapsedDirs).has(path)) toggleDir(path);
			else {
				const parent = parentDirOf(path);
				if (parent) {
					treeEl
						.querySelector<HTMLElement>(`[data-tree-entry][data-path="${CSS.escape(parent)}"]`)
						?.focus();
				}
			}
		}
	}

	async function onMove(path: string, toDir: string | null) {
		const ok = await movePath(path, toDir);
		if (ok && toDir) expandDir(toDir);
	}

	function onDrop(source: DragSource, target: DropTarget) {
		if (target.kind === 'move') void onMove(source.path, target.dir);
		else if (target.kind === 'pin') {
			movePin(source.path, target.before);
			setPinGlobal(source.path, target.global);
		} else togglePin(source.path);
	}

	function startDrag(e: PointerEvent, path: string, kind: 'file' | 'directory', fromPins: boolean) {
		beginDrag(e, { path, kind, fromPins, project: projectOf(path, projectSet) ?? '' }, onDrop);
	}

	const dropTarget = $derived($drag?.target ?? null);
	const pinBefore = $derived(dropTarget?.kind === 'pin' ? dropTarget.before : undefined);
	// Whether a drop at the end of this pin list is the target (draws its
	// insertion line): the global list (undefined), or a project's, which
	// only the project's own notes can drop on.
	const endOfList = (key?: ProjectKey) =>
		dropTarget?.kind === 'pin' &&
		dropTarget.before === null &&
		(key === undefined ? dropTarget.global : !dropTarget.global && ($drag?.source.project || null) === key);
	// A note dragged from the tree can be pinned even when nothing is pinned yet.
	const pinDropOpen = $derived(
		!!$drag && !$drag.source.fromPins && $drag.source.path.endsWith('.md')
	);
	// A section offers an empty pin list while one of its notes is dragged
	// that is not pinned to it yet.
	const pinDropHere = (key: ProjectKey) =>
		!!$drag &&
		$drag.source.path.endsWith('.md') &&
		($drag.source.project || null) === key &&
		(!$drag.source.fromPins || $globalPins.includes($drag.source.path));
	// What releasing would do, shown on the lifted row.
	const dropLabel = $derived.by(() => {
		if (!$drag || !dropTarget) return null;
		if (dropTarget.kind === 'unpin') return 'Unpin';
		if (dropTarget.kind === 'pin') {
			const path = $drag.source.path;
			if ($pinnedPaths.includes(path) && $globalPins.includes(path) === dropTarget.global) return null;
			return dropTarget.global ? 'Pin everywhere' : `Pin in ${projectLabel($drag.source.project || null)}`;
		}
		return `Move to ${dropTarget.dir ? dropTarget.dir.split('/').pop() : projectLabel(null)}`;
	});
	const dragIcon = $derived(
		!$drag
			? ''
			: $drag.source.kind === 'directory'
				? 'folder'
				: $drag.source.path.endsWith('.md')
					? 'description'
					: 'draft'
	);

	function countNotes(entries: VaultEntry[]): number {
		let n = 0;
		for (const e of entries) {
			if (e.type === 'directory') n += countNotes(e.children ?? []);
			else if (e.name.endsWith('.md')) n++;
		}
		return n;
	}
	const noteCount = $derived(shownSections.reduce((n, s) => n + countNotes(s.entries), 0));
	const pinName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');

	// Pins are per browser, so a note deleted elsewhere (another device, an
	// agent) can linger in the list; only show pins that still exist.
	function hasFile(entries: VaultEntry[], path: string): boolean {
		return entries.some((e) =>
			e.type === 'file' ? e.path === path : path.startsWith(e.path + '/') && hasFile(e.children ?? [], path)
		);
	}
	const livePins = $derived($pinnedPaths.filter((p) => hasFile($tree, p)));
	const topPins = $derived(livePins.filter((p) => $globalPins.includes(p)));
	const pinsIn = (key: ProjectKey) =>
		livePins.filter((p) => !$globalPins.includes(p) && projectOf(p, projectSet) === key);

	function pinItems(path: string): ContextMenuItem[] {
		const here = projectLabel(projectOf(path, projectSet));
		if (!$pinnedPaths.includes(path))
			return [
				{ label: `Pin in ${here}`, action: () => setPinGlobal(path, false) },
				{ label: 'Pin everywhere', action: () => setPinGlobal(path, true) }
			];
		return [
			$globalPins.includes(path)
				? { label: `Pin in ${here} only`, action: () => setPinGlobal(path, false) }
				: { label: 'Pin everywhere', action: () => setPinGlobal(path, true) },
			{ label: 'Unpin', action: () => togglePin(path) }
		];
	}

	const menuItems = $derived.by((): ContextMenuItem[] => {
		if (!menu) return [];
		const newProject = { label: 'New project...', action: () => newProjectOpen.set(true) };
		if (menu.kind === 'view') {
			const pick = (v: ProjectView) => () => setView(v);
			return [
				{ label: 'All projects', action: pick('all') },
				...sections.map((s) => ({ label: projectLabel(s.key), action: pick({ project: s.key }) })),
				newProject
			];
		}
		if (menu.kind === 'blank') {
			return [
				{ label: 'New note', action: () => startCreate(homeDir, 'note') },
				{ label: 'New folder', action: () => startCreate(homeDir, 'folder') },
				newProject
			];
		}
		if (menu.kind === 'section') {
			const key = menu.key;
			const items: ContextMenuItem[] = [
				{ label: 'New note', action: () => startCreate(key, 'note') },
				{ label: 'New folder', action: () => startCreate(key, 'folder') },
				{ label: 'Open board', action: () => void openBoard({ project: key }) }
			];
			if (key === null) return [...items, newProject];
			return [
				...items,
				{ label: 'Rename project', action: () => (renameTarget = { path: key }) },
				{ label: 'Remove project', action: () => void dropProject(key) }
			];
		}
		const { entry, pinRow } = menu;
		if (entry.type === 'file') {
			const items: ContextMenuItem[] = [
				...(pinRow ? [] : [{ label: 'Rename', action: () => (renameTarget = { path: entry.path }) }]),
				{ label: 'Archive', action: () => void archivePath(entry.path) },
				{ label: 'Delete', danger: true, action: () => void deletePath(entry.path) }
			];
			// Notes download as plain text; other assets open in the preview
			// overlay instead, so only .md entries get a download row.
			if (entry.path.endsWith('.md')) {
				items.splice(
					pinRow ? 0 : 1,
					0,
					...pinItems(entry.path),
					{
						label: 'Download as .md',
						action: () => void downloadNote(entry.path).catch(() => {})
					},
					{
						label: 'Print / PDF',
						action: () => goto(`/print?note=${encodeURIComponent(entry.path)}`)
					}
				);
			}
			return items;
		}
		return [
			{ label: 'New note', action: () => startCreate(entry.path, 'note') },
			{ label: 'New folder', action: () => startCreate(entry.path, 'folder') },
			{ label: 'Rename', action: () => (renameTarget = { path: entry.path }) },
			...(entry.path.includes('/') ? [] : [{ label: 'Make project', action: () => void makeProject(entry.path) }]),
			{ label: 'Archive', action: () => void archivePath(entry.path) },
			{ label: 'Delete', danger: true, action: () => void deletePath(entry.path) }
		];
	});

	let renameName = $state('');
	$effect(() => {
		if (renameTarget && projectSet.has(renameTarget.path)) renameName = renameTarget.path;
	});
	function commitProjectRename(key: string) {
		if (renameTarget?.path !== key) return;
		const name = renameName.trim();
		if (name && name !== key) void commitRename(key, name);
		else renameTarget = null;
	}
</script>

{#snippet pinRow(p: string, last: boolean, key?: ProjectKey)}
	<button
		class="pin-row"
		class:active={$activePath === p}
		class:dragging={$drag?.source.fromPins && $drag.source.path === p}
		class:ins-before={pinBefore === p}
		class:ins-after={last && endOfList(key)}
		title={p}
		data-pin={p}
		onclick={() => onSelect(p)}
		onpointerdown={(e) => startDrag(e, p, 'file', true)}
		oncontextmenu={(e) => {
			e.preventDefault();
			e.stopPropagation();
			menu = {
				x: e.clientX,
				y: e.clientY,
				kind: 'entry',
				entry: { name: pinName(p), path: p, type: 'file' },
				pinRow: true
			};
		}}
	>
		<span class="material-symbols-outlined">keep</span>
		<span class="pin-name">{pinName(p)}</span>
	</button>
{/snippet}

<aside
	oncontextmenu={(e) => {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, kind: 'blank' };
	}}
>
	<div class="header">
		<AppSwitcher current="notes" />
		<span class="sp"></span>
		<button class="icon-btn" title="New note (Space n)" onclick={() => startCreate(homeDir, 'note')}>
			<span class="material-symbols-outlined">edit_square</span>
		</button>
		<button class="icon-btn" title="New folder (Space N)" onclick={() => startCreate(homeDir, 'folder')}>
			<span class="material-symbols-outlined">create_new_folder</span>
		</button>
		<button class="icon-btn" onclick={onToggleCollapse} title="Collapse sidebar (Ctrl+/)">
			<span class="material-symbols-outlined">left_panel_close</span>
		</button>
	</div>
	<button
		class="view-pick"
		title="Show one project or all of them"
		onclick={(e) => {
			const r = e.currentTarget.getBoundingClientRect();
			menu = { x: r.left, y: r.bottom + 4, kind: 'view' };
		}}
	>
		<span class="material-symbols-outlined">{current === 'all' ? 'apps' : 'folder'}</span>
		<span class="pin-name">{current === 'all' ? 'All projects' : projectLabel(current.project)}</span>
		<span class="sp"></span>
		<span class="material-symbols-outlined">unfold_more</span>
	</button>
	<SearchBox {onSelect} folder={homeDir ?? undefined} />
	<div
		class="scroll"
		data-drag-scroll
		role="tree"
		aria-label="Vault files"
		tabindex="-1"
		bind:this={treeEl}
		onkeydown={treeKey}
	>
		{#if topPins.length > 0 || pinDropOpen}
			<div class="pins" data-drop-pins>
				<div class="group"><span class="material-symbols-outlined">keep</span>Pinned</div>
				{#each topPins as p, i (p)}
					{@render pinRow(p, i === topPins.length - 1)}
				{/each}
				{#if topPins.length === 0}
					<div class="pin-empty" class:drop-target={endOfList()}>Drop to pin everywhere</div>
				{/if}
			</div>
		{/if}
		{#each shownSections as s (foldKey(s.key))}
			{@const folded = $collapsedDirs.has(foldKey(s.key))}
			{@const pins = pinsIn(s.key)}
			{@const open = openTasks.get(s.key) ?? 0}
			<section
				class:drop-root={dropTarget?.kind === 'move' && dropTarget.dir === s.key}
				data-drop-dir={s.key ?? ''}
			>
				{#if s.key !== null && renameTarget?.path === s.key}
					<input
						class="rename-input"
						bind:value={renameName}
						{@attach (el) => el.select()}
						onkeydown={(e) => {
							if (e.key === 'Enter') commitProjectRename(s.key!);
							if (e.key === 'Escape') renameTarget = null;
						}}
						onblur={() => commitProjectRename(s.key!)}
					/>
				{:else}
					<div
						class="group sec-h"
						role="button"
						tabindex="0"
						title={folded ? 'Expand' : 'Collapse'}
						onclick={() => toggleDir(foldKey(s.key))}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								toggleDir(foldKey(s.key));
							}
						}}
						oncontextmenu={(e) => {
							e.preventDefault();
							e.stopPropagation();
							menu = { x: e.clientX, y: e.clientY, kind: 'section', key: s.key };
						}}
					>
						<span class="material-symbols-outlined">{folded ? 'chevron_right' : 'expand_more'}</span>
						<span class="pin-name">{projectLabel(s.key)}</span>
						<span class="acts">
							<button
								class="icon-btn sm"
								title="Open board"
								onclick={(e) => {
									e.stopPropagation();
									void openBoard({ project: s.key });
								}}
							>
								<span class="material-symbols-outlined">view_kanban</span>
							</button>
							<button
								class="icon-btn sm"
								title="New note in {projectLabel(s.key)}"
								onclick={(e) => {
									e.stopPropagation();
									startCreate(s.key, 'note');
								}}
							>
								<span class="material-symbols-outlined">add</span>
							</button>
						</span>
						{#if open > 0}<span class="open" title="Open tasks">{open}</span>{/if}
					</div>
				{/if}
				{#if !folded}
					{#if pins.length > 0 || pinDropHere(s.key)}
						<div class="pins" data-drop-pins data-project={s.key ?? ''}>
							{#each pins as p, i (p)}
								{@render pinRow(p, i === pins.length - 1, s.key)}
							{/each}
							{#if pins.length === 0}
								<div class="pin-empty" class:drop-target={endOfList(s.key)}>
									Drop to pin in {projectLabel(s.key)}
								</div>
							{/if}
						</div>
					{/if}
					<div class="tree">
						<FileTree
							entries={s.entries}
							dirPath={s.key}
							{onSelect}
							{onOpenAsset}
							onContextMenu={onEntryContextMenu}
							onDragStart={(e, entry) => startDrag(e, entry.path, entry.type, false)}
							{createTarget}
							{renameTarget}
							onCreate={commitCreate}
							onRename={commitRename}
							onCancelCreate={() => (createTarget = null)}
							onCancelRename={() => (renameTarget = null)}
						/>
					</div>
				{/if}
			</section>
		{/each}
	</div>
	<div class="footer">
		<span class="count">{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
		<span class="sp"></span>
		<AppActions />
	</div>
	{#if menu}
		<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = null)} />
	{/if}
	{#if $drag}
		<div class="drag-card" style="top: {$drag.top}px; left: {$drag.left}px; width: {$drag.width}px">
			<span class="material-symbols-outlined">{dragIcon}</span>
			<span class="drag-name">{pinName($drag.source.path)}</span>
			{#if dropLabel}<span class="drop-label">{dropLabel}</span>{/if}
		</div>
	{/if}
</aside>

<style>
	aside {
		width: 100%;
		flex-shrink: 0;
		background: var(--panel);
		border-right: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 48px;
		padding: 0 8px 0 16px;
		flex-shrink: 0;
	}
	.sp {
		flex: 1;
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
		flex-shrink: 0;
	}
	.icon-btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 12px;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 12px 16px 4px;
		color: var(--text-3);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.group .material-symbols-outlined {
		font-size: 16px;
	}
	.pin-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		width: calc(100% - 12px);
		height: 29px;
		margin: 0 6px;
		padding: 0 8px 0 14px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font-size: var(--fs);
		text-align: left;
		cursor: pointer;
	}
	:global(html.sidebar-dragging) .pin-row:not(.active):hover {
		background: none;
		color: var(--text-2);
	}
	.pin-row.dragging {
		opacity: 0.4;
	}
	/* Insertion line where a dragged note would land in the pin order. */
	.pin-row.ins-before::before,
	.pin-row.ins-after::after {
		content: '';
		position: absolute;
		left: 8px;
		right: 8px;
		height: 2px;
		border-radius: 1px;
		background: var(--accent);
	}
	.pin-row.ins-before::before {
		top: -1px;
	}
	.pin-row.ins-after::after {
		bottom: -1px;
	}
	.pin-empty {
		display: flex;
		align-items: center;
		height: 29px;
		margin: 0 6px;
		padding: 0 14px;
		border: 1px dashed var(--line-2);
		border-radius: var(--r);
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.pin-empty.drop-target {
		border-color: var(--accent);
		color: var(--text);
	}
	.pin-row .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.pin-row:hover {
		background: var(--hover);
		color: var(--text);
	}
	.pin-row.active {
		background: var(--accent-dim);
		color: var(--text);
	}
	.pin-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tree {
		padding: 0 6px;
		min-height: 40px;
	}
	section.drop-root {
		background: var(--hover);
		box-shadow: inset 0 0 0 1px var(--accent);
		border-radius: var(--r);
	}
	.view-pick {
		display: flex;
		align-items: center;
		gap: 8px;
		width: calc(100% - 12px);
		height: 29px;
		margin: 0 6px 6px;
		padding: 0 8px 0 10px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: 500 var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.view-pick:hover {
		background: var(--hover);
	}
	.view-pick .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.sec-h {
		cursor: pointer;
		padding-right: 8px;
	}
	.sec-h:hover {
		color: var(--text);
	}
	.sec-h .acts {
		display: none;
		margin-left: auto;
		gap: 2px;
	}
	.sec-h:hover .acts,
	.sec-h:focus-within .acts {
		display: flex;
	}
	.sec-h:hover .open {
		display: none;
	}
	.icon-btn.sm {
		width: 22px;
		height: 22px;
	}
	.open {
		margin-left: auto;
		color: var(--text-3);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.rename-input {
		width: calc(100% - 12px);
		height: 26px;
		margin: 8px 6px 2px;
		padding: 0 8px;
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: var(--r);
		color: var(--text);
		font: 500 var(--fs-sm) var(--font-ui);
		outline: none;
	}
	.footer {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 26px;
		padding: 0 6px 0 16px;
		border-top: 1px solid var(--line);
		flex-shrink: 0;
	}
	.count {
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	/* The lifted row: opaque so the list never shows through, pointer-events
	   off so hit-testing sees the rows beneath it. */
	.drag-card {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 29px;
		padding: 0 10px;
		border-radius: var(--r);
		background: var(--hover);
		box-shadow:
			0 8px 24px rgb(0 0 0 / 0.6),
			inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: var(--fs) var(--font-ui);
	}
	.drag-card .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.drag-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.drop-label {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--accent);
		font-size: var(--fs-xs);
	}
	:global(html.sidebar-dragging),
	:global(html.sidebar-dragging *) {
		cursor: grabbing !important;
		user-select: none;
	}
</style>
