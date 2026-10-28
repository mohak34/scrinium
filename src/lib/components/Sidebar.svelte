<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { settings } from '$lib/stores/settings';
	import FileTree from './FileTree.svelte';
	import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
	import ProjectStylePicker from './ProjectStylePicker.svelte';
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
		deletePath,
		archivePath,
		movePath,
		movePin,
		fileOrder,
		inFileOrder,
		placeFile,
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
		newProjectOpen,
		topLevel
	} from '$lib/stores/tasks';
	import {
		projectOf,
		projectLabel,
		projectStyle,
		colorVar,
		boardHref,
		type ProjectKey,
		type ProjectView
	} from '$lib/projects';
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
		| { kind: 'view'; width: number };
	let menu = $state<({ x: number; y: number } & MenuOn) | null>(null);
	let stylePicker = $state<{ x: number; y: number; path: string } | null>(null);
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
	const styleOf = $derived.by(() => {
		const rows = new Map($projects.map((p) => [p.path, p]));
		return (key: ProjectKey) => projectStyle(key, key === null ? undefined : rows.get(key));
	});
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

	// Done and total cards on each project's board, subtasks left out like
	// the board does. Feeds the header's progress ring.
	const progress = $derived.by(() => {
		const counts = new Map<ProjectKey, { done: number; total: number }>();
		for (const t of topLevel($tasks)) {
			const c = counts.get(t.project) ?? { done: 0, total: 0 };
			c.total++;
			if (t.status === 'done') c.done++;
			counts.set(t.project, c);
		}
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

	// A typed name may be a path: `work/test1` makes the note inside a new
	// `work` folder, and a trailing `/` makes the whole thing a folder.
	async function commitCreate(parent: string | null, kind: 'note' | 'folder', rawName: string) {
		const parts = rawName.split('/').map((p) => p.trim());
		if (rawName.trim().endsWith('/')) kind = 'folder';
		const segments = parts.filter(Boolean).map((p, i, all) => sanitizeName(p, i === all.length - 1 ? kind : 'folder'));
		if (!segments.length || segments.some((s) => s === null)) {
			createTarget = null;
			return;
		}
		const path = uniquePath(parent, segments.join('/'));
		for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) expandDir(path.slice(0, i));
		if (kind === 'folder') {
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

	async function onMove(path: string, toDir: string | null, place?: { path: string; after: boolean }) {
		let at = path;
		if (parentDirOf(path) !== toDir) {
			// A pin dropped into a pinned folder would stay hidden from that
			// folder's tree; it unpins and shows there instead.
			const intoPin = $pinnedPaths.includes(path) && toDir !== null && inPinnedDir(toDir);
			const name = path.split('/').pop()!;
			if (!(await movePath(path, toDir))) {
				if (findEntry($tree, joinPath(toDir, name))) alert(`${toDir ?? projectLabel(null)} already has "${name}".`);
				return;
			}
			at = joinPath(toDir, name);
			renameDir(path, at);
			if (intoPin) togglePin(at);
			if (toDir) expandDir(toDir);
		}
		// A file's spot in its old folder means nothing in the new one.
		if (!place) return fileOrder.update((order) => order.filter((p) => p !== at));
		const siblings = inFileOrder(filesIn($tree, toDir), $fileOrder).map((e) => e.path);
		placeFile(at, siblings, place.path, place.after);
	}

	// The files directly in folder `dir` (null for the vault root).
	function filesIn(entries: VaultEntry[], dir: string | null): VaultEntry[] {
		if (dir === null) return entries.filter((e) => e.type === 'file');
		for (const e of entries) {
			if (e.type !== 'directory') continue;
			if (e.path === dir) return (e.children ?? []).filter((c) => c.type === 'file');
			if (dir.startsWith(e.path + '/')) return filesIn(e.children ?? [], dir);
		}
		return [];
	}

	function onDrop(source: DragSource, target: DropTarget) {
		if (target.kind === 'move') void onMove(source.path, target.dir, target.place);
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
	// Whether the dragged item can pin onto a list: the global one (undefined)
	// takes any note, a project's only that project's notes. The project
	// header and the switcher bar then offer a pin target, so even an empty
	// list can be dropped on without anything appearing in the tree.
	const canPin = (key?: ProjectKey) =>
		!!$drag &&
		($drag.source.fromPins || $drag.source.kind === 'directory' || $drag.source.path.endsWith('.md')) &&
		(key === undefined || ($drag.source.project || null) === key);
	// What releasing would do, shown on the lifted row.
	const dropLabel = $derived.by(() => {
		if (!$drag || !dropTarget) return null;
		if (dropTarget.kind === 'unpin') return 'Unpin';
		if (dropTarget.kind === 'pin') {
			const path = $drag.source.path;
			if ($pinnedPaths.includes(path) && $globalPins.includes(path) === dropTarget.global) return null;
			return dropTarget.global ? 'Pin everywhere' : `Pin in ${projectLabel($drag.source.project || null)}`;
		}
		// Reordering within its own folder needs no label; the line says it.
		if (dropTarget.place && dropTarget.dir === parentDirOf($drag.source.path)) return null;
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

	function findEntry(entries: VaultEntry[], path: string): VaultEntry | undefined {
		for (const e of entries) {
			if (e.path === path) return e;
			if (e.type === 'directory' && path.startsWith(e.path + '/')) return findEntry(e.children ?? [], path);
		}
	}
	// Pins are per browser, so a note deleted elsewhere (another device, an
	// agent) can linger in the list; only show pins that still exist. Pinned
	// folders come before pinned notes.
	const pinEntries = $derived(
		new Map(
			$pinnedPaths.flatMap((p) => {
				// A folder that became a project shows as its section instead.
				if (projectSet.has(p)) return [];
				const e = findEntry($tree, p);
				return e ? [[p, e] as const] : [];
			})
		)
	);
	const inPinnedDir = (dir: string) =>
		[...pinEntries.values()].some((e) => e.type === 'directory' && (dir === e.path || dir.startsWith(e.path + '/')));
	const livePins = $derived.by(() => {
		const pinned = [...pinEntries.values()];
		return [...pinned.filter((e) => e.type === 'directory'), ...pinned.filter((e) => e.type === 'file')].map(
			(e) => e.path
		);
	});
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
				{ label: 'All projects', icon: 'apps', current: current === 'all', action: pick('all') },
				...sections.map((s) => {
					const st = styleOf(s.key);
					return {
						label: projectLabel(s.key),
						icon: st.icon,
						color: colorVar(st.color),
						current: current !== 'all' && current.project === s.key,
						action: pick({ project: s.key })
					};
				}),
				{ ...newProject, icon: 'add' }
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
			const at = { x: menu.x, y: menu.y };
			const items: ContextMenuItem[] = [
				{ label: 'New note', action: () => startCreate(key, 'note') },
				{ label: 'New folder', action: () => startCreate(key, 'folder') },
				{ label: 'Open board', action: () => void openBoard({ project: key }) }
			];
			if (key === null) return [...items, newProject];
			return [
				...items,
				{ label: 'Rename project', action: () => (renameTarget = { path: key }) },
				{ label: 'Icon and color', action: () => (stylePicker = { ...at, path: key }) },
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
			...pinItems(entry.path),
			{ label: 'New note', action: () => startCreate(entry.path, 'note') },
			{ label: 'New folder', action: () => startCreate(entry.path, 'folder') },
			...(pinRow ? [] : [{ label: 'Rename', action: () => (renameTarget = { path: entry.path }) }]),
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
	{@const entry = pinEntries.get(p)!}
	{@const isDir = entry.type === 'directory'}
	{@const open = isDir && !$collapsedDirs.has(p)}
	<button
		class="pin-row"
		class:dir={isDir}
		class:active={$activePath === p}
		class:dragging={$drag?.source.fromPins && $drag.source.path === p}
		class:ins-before={pinBefore === p}
		class:ins-after={last && endOfList(key)}
		class:drop-into={isDir && dropTarget?.kind === 'move' && !dropTarget.place && dropTarget.dir === p}
		title={p}
		data-pin={p}
		data-pin-dir={isDir || undefined}
		onclick={() => (isDir ? toggleDir(p) : onSelect(p))}
		onpointerdown={(e) => startDrag(e, p, entry.type, true)}
		oncontextmenu={(e) => {
			e.preventDefault();
			e.stopPropagation();
			menu = { x: e.clientX, y: e.clientY, kind: 'entry', entry, pinRow: true };
		}}
	>
		{#if key !== undefined}
			<span class="material-symbols-outlined">keep</span>
		{/if}
		{#if isDir}
			<span class="material-symbols-outlined fill dir-icon">{open ? 'folder_open' : 'folder'}</span>
		{:else if key === undefined}
			<span class="material-symbols-outlined file-icon">draft</span>
		{/if}
		<span class="pin-name">{pinName(p)}</span>
		{#if isDir}
			<span class="sp"></span>
			<span class="material-symbols-outlined chev">{open ? 'expand_more' : 'chevron_right'}</span>
		{/if}
	</button>
	{#if open}
		<div class="pin-tree" data-pin-tree={p}>
		<FileTree
			entries={entry.children ?? []}
			dirPath={p}
			depth={1}
			{onSelect}
			{onOpenAsset}
			onContextMenu={onEntryContextMenu}
			onDragStart={(e, child) => startDrag(e, child.path, child.type, false)}
			{createTarget}
			{renameTarget}
			onCreate={commitCreate}
			onRename={commitRename}
			onCancelCreate={() => (createTarget = null)}
			onCancelRename={() => (renameTarget = null)}
		/>
		</div>
	{/if}
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
		class:pin-drop={canPin()}
		class:on={canPin() && endOfList()}
		data-drop-pins={canPin() || undefined}
		data-pin-here={canPin() || undefined}
		title="Show one project or all of them"
		onclick={(e) => {
			const r = e.currentTarget.getBoundingClientRect();
			menu = { x: r.left, y: r.bottom + 4, kind: 'view', width: r.width };
		}}
	>
		{#if canPin()}
			<span class="material-symbols-outlined">keep</span>
		{:else if current === 'all'}
			<span class="material-symbols-outlined">apps</span>
		{:else}
			{@const st = styleOf(current.project)}
			<span class="material-symbols-outlined fill" style:color={colorVar(st.color)}>{st.icon}</span>
		{/if}
		<span class="pin-name">
			{canPin() ? 'Pin everywhere' : current === 'all' ? 'All projects' : projectLabel(current.project)}
		</span>
		<span class="sp"></span>
		{#if !canPin()}
			<span class="material-symbols-outlined">unfold_more</span>
		{/if}
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
		{#if topPins.length > 0}
			<div class="pins" data-drop-pins>
				<div class="group sec-h pins-h">
					<span class="ring">
						<svg viewBox="0 0 30 30" aria-hidden="true"><circle class="track" cx="15" cy="15" r="12" /></svg>
						<span class="material-symbols-outlined fill">keep</span>
					</span>
					<span class="pin-name">Pinned</span>
					<span class="sp"></span>
					<span class="sec-s">{topPins.length}</span>
				</div>
				{#each topPins as p, i (p)}
					{@render pinRow(p, i === topPins.length - 1)}
				{/each}
			</div>
		{/if}
		{#each shownSections as s (foldKey(s.key))}
			{@const folded = $collapsedDirs.has(foldKey(s.key))}
			{@const pins = pinsIn(s.key)}
			{@const pr = progress.get(s.key) ?? { done: 0, total: 0 }}
			{@const st = styleOf(s.key)}
			<section
				class:drop-root={dropTarget?.kind === 'move' && !dropTarget.place && dropTarget.dir === s.key}
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
						class:pin-on={canPin(s.key) && endOfList(s.key)}
						style:--c={colorVar(st.color)}
						data-drop-pins={canPin(s.key) || undefined}
						data-pin-here={canPin(s.key) || undefined}
						data-project={canPin(s.key) ? (s.key ?? '') : undefined}
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
						<span class="ring">
							<svg viewBox="0 0 30 30" aria-hidden="true">
								<circle class="track" cx="15" cy="15" r="12" />
								{#if pr.done > 0}
									<circle
										class="arc"
										cx="15"
										cy="15"
										r="12"
										pathLength="100"
										stroke-dasharray="{(pr.done / pr.total) * 100} 100"
									/>
								{/if}
							</svg>
							<span class="material-symbols-outlined fill">{st.icon}</span>
						</span>
						<span class="pin-name">{projectLabel(s.key)}</span>
						<span class="sp"></span>
						{#if canPin(s.key)}
							<span class="sec-pin" class:on={endOfList(s.key)}>
								<span class="material-symbols-outlined">keep</span>Pin
							</span>
						{:else if pr.total > 0}
							<span class="sec-s" title="{pr.done} of {pr.total} tasks done">{pr.done}/{pr.total}</span>
						{/if}
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
						<span class="material-symbols-outlined chev">{folded ? 'chevron_right' : 'expand_more'}</span>
					</div>
				{/if}
				{#if !folded}
					{#if pins.length > 0}
						<div class="pins" data-drop-pins data-project={s.key ?? ''}>
							{#each pins as p, i (p)}
								{@render pinRow(p, i === pins.length - 1, s.key)}
							{/each}
						</div>
					{/if}
					<div class="tree">
						{#if s.entries.length === 0 && createTarget?.parent !== s.key}
							<div class="tree-empty">No notes</div>
						{/if}
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
		<ContextMenu
			x={menu.x}
			y={menu.y}
			width={menu.kind === 'view' ? menu.width : undefined}
			items={menuItems}
			onClose={() => (menu = null)}
		/>
	{/if}
	{#if stylePicker}
		{@const st = styleOf(stylePicker.path)}
		<ProjectStylePicker {...stylePicker} icon={st.icon} color={st.color} onClose={() => (stylePicker = null)} />
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
	/* The global pins' band: a project header in plain text color. */
	.pins-h.sec-h {
		--c: var(--text);
		cursor: default;
	}
	.pin-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		width: calc(100% - 12px);
		height: 29px;
		margin: 0 6px;
		padding: 0 8px;
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
	.pin-row.dir {
		color: var(--text);
		font-weight: 550;
	}
	.pin-row .file-icon {
		color: var(--text-3);
	}
	.pin-row .dir-icon {
		color: var(--text-2);
	}
	.pin-row.drop-into {
		background: var(--hover);
		box-shadow: inset 0 0 0 1px var(--accent);
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
	.tree,
	.pin-tree {
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
	/* A project header is a band washed in its color that sticks to the top
	   while its section scrolls; the band is opaque so rows slide under it. */
	.sec-h {
		position: sticky;
		top: 0;
		z-index: 1;
		gap: 9px;
		height: 34px;
		margin-top: 6px;
		padding: 0 10px 0 12px;
		background: color-mix(in srgb, var(--c) 8%, var(--panel));
		color: var(--c);
		cursor: pointer;
	}
	.ring {
		position: relative;
		flex-shrink: 0;
		width: 24px;
		height: 24px;
	}
	.ring svg {
		position: absolute;
		inset: 0;
		fill: none;
		stroke-width: 2.5;
	}
	.ring .track {
		stroke: color-mix(in srgb, var(--c) 22%, var(--panel));
	}
	.ring .arc {
		stroke: var(--c);
		stroke-linecap: round;
		transform: rotate(-90deg);
		transform-origin: center;
	}
	.ring .material-symbols-outlined {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
	}
	.sec-h .pin-name {
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.sec-s {
		color: color-mix(in srgb, var(--c) 60%, var(--text-3));
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	/* The icon font has one weight; a stroke makes the arrow read bolder. */
	.sec-h > .chev {
		font-size: 17px;
		-webkit-text-stroke: 0.6px currentColor;
	}
	/* The buttons replace the count on hover or keyboard focus. A mouse
	   click leaves focus on the header, so plain :focus-within would keep
	   them up. */
	.sec-h .acts {
		display: none;
		gap: 2px;
	}
	.sec-h:is(:hover, :focus-visible, :has(:focus-visible)) .acts {
		display: flex;
	}
	.sec-h:is(:hover, :focus-visible, :has(:focus-visible)) .sec-s {
		display: none;
	}
	:global(html.sidebar-dragging) .sec-h .acts {
		display: none;
	}
	/* Pin targets on the header and the switcher bar while a note is dragged. */
	.sec-pin {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 8px 0 6px;
		border-radius: var(--r);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent);
		color: var(--c);
		font-size: var(--fs-xs);
	}
	.sec-pin .material-symbols-outlined {
		font-size: 14px;
	}
	.sec-h.pin-on {
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.sec-pin.on,
	.view-pick.pin-drop.on {
		background: var(--hover);
		box-shadow: inset 0 0 0 1px var(--accent);
		color: var(--accent);
	}
	.view-pick.pin-drop {
		box-shadow: inset 0 0 0 1px var(--border-raised);
	}
	.view-pick.pin-drop.on .material-symbols-outlined {
		color: var(--accent);
	}
	.icon-btn.sm {
		width: 22px;
		height: 22px;
	}
	.tree-empty {
		padding: 6px 30px;
		color: var(--text-4);
		font-size: var(--fs-xs);
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
