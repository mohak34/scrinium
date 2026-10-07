<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { settings } from '$lib/stores/settings';
	import FileTree from './FileTree.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import SearchBox from './SearchBox.svelte';
	import {
		tree,
		pinnedPaths,
		activePath,
		createNote,
		createFolder,
		renameNote,
		syncFilenameToTitle,
		deletePath,
		movePath,
		downloadNote,
		type VaultEntry
	} from '$lib/stores/vault';
	import {
		expandDir,
		renameDir,
		parentDirOf,
		toggleDir,
		collapsedDirs,
		dragPath,
		dragKind,
		dropRoot,
		canDrop
	} from '$lib/stores/filetree';
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

	let menu = $state<{ x: number; y: number; entry: VaultEntry | null } | null>(null);
	let createTarget = $state<{ parent: string | null; kind: 'note' | 'folder' } | null>(null);
	let renameTarget = $state<{ path: string } | null>(null);
	let treeEl = $state<HTMLDivElement>();

	// The command palette signals "create a note/folder here" through the shared
	// createRequest store; hand it over to the inline create inputs.
	onMount(() => {
		const unsubCreate = createRequest.subscribe((req) => {
			if (req) {
				createTarget = req;
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
			renameTarget = { path: req.path };
		});
		return () => {
			unsubCreate();
			unsubRename();
		};
	});

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
				const ok = await renameNote(path, newPath);
				if (ok) {
					renameDir(path, newPath);
					await syncFilenameToTitle(path, newPath);
				}
			}
		}
		renameTarget = null;
	}

	function onEntryContextMenu(entry: VaultEntry, x: number, y: number) {
		menu = { x, y, entry };
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

	function rootDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		if (canDrop($dragPath, null, $dragKind)) dropRoot.set(true);
	}

	function rootDrop(e: DragEvent) {
		e.preventDefault();
		dropRoot.set(false);
		const source = $dragPath;
		const kind = $dragKind;
		dragPath.set(null);
		dragKind.set(null);
		if (source && kind && canDrop(source, null, kind)) void onMove(source, null);
	}

	function countNotes(entries: VaultEntry[]): number {
		let n = 0;
		for (const e of entries) {
			if (e.type === 'directory') n += countNotes(e.children ?? []);
			else if (e.name.endsWith('.md')) n++;
		}
		return n;
	}
	const noteCount = $derived(countNotes($tree));
	const pinName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');

	const menuItems = $derived.by(() => {
		if (!menu) return [];
		const entry = menu.entry;
		if (!entry) {
			return [
				{ label: 'New note', action: () => (createTarget = { parent: null, kind: 'note' }) },
				{ label: 'New folder', action: () => (createTarget = { parent: null, kind: 'folder' }) }
			];
		}
		if (entry.type === 'file') {
			const items: { label: string; danger?: boolean; action: () => void }[] = [
				{ label: 'Rename', action: () => (renameTarget = { path: entry.path }) },
				{ label: 'Delete', danger: true, action: () => void deletePath(entry.path) }
			];
			// Notes download as plain text; other assets open in the preview
			// overlay instead, so only .md entries get a download row.
			if (entry.path.endsWith('.md')) {
				items.splice(
					1,
					0,
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
			{
				label: 'New note',
				action: () => (createTarget = { parent: entry.path, kind: 'note' })
			},
			{
				label: 'New folder',
				action: () => {
					expandDir(entry.path);
					createTarget = { parent: entry.path, kind: 'folder' };
				}
			},
			{ label: 'Rename', action: () => (renameTarget = { path: entry.path }) },
			{ label: 'Delete', danger: true, action: () => void deletePath(entry.path) }
		];
	});
</script>

<aside
	oncontextmenu={(e) => {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, entry: null };
	}}
>
	<div class="header">
		<AppSwitcher current="notes" />
		<span class="sp"></span>
		<button
			class="icon-btn"
			title="New note (Space n)"
			onclick={() => (createTarget = { parent: null, kind: 'note' })}
		>
			<span class="material-symbols-outlined">edit_square</span>
		</button>
		<button
			class="icon-btn"
			title="New folder (Space N)"
			onclick={() => (createTarget = { parent: null, kind: 'folder' })}
		>
			<span class="material-symbols-outlined">create_new_folder</span>
		</button>
		<button class="icon-btn" onclick={onToggleCollapse} title="Collapse sidebar (Ctrl+/)">
			<span class="material-symbols-outlined">left_panel_close</span>
		</button>
	</div>
	<SearchBox {onSelect} />
	<div class="scroll">
		{#if $pinnedPaths.length > 0}
			<div class="group"><span class="material-symbols-outlined">keep</span>Pinned</div>
			{#each $pinnedPaths as p (p)}
				<button class="pin-row" class:active={$activePath === p} title={p} onclick={() => onSelect(p)}>
					<span class="material-symbols-outlined">description</span>
					<span class="pin-name">{pinName(p)}</span>
				</button>
			{/each}
		{/if}
		<div class="group"><span class="material-symbols-outlined">folder</span>Files</div>
		<div
			class="tree"
			class:drop-root={$dropRoot}
			role="tree"
			aria-label="Vault files"
			tabindex="-1"
			bind:this={treeEl}
			onkeydown={treeKey}
			ondragover={rootDragOver}
			ondragleave={() => dropRoot.set(false)}
			ondrop={rootDrop}
		>
			<FileTree
				entries={$tree}
				{onSelect}
				{onOpenAsset}
				onContextMenu={onEntryContextMenu}
				{onMove}
				{createTarget}
				{renameTarget}
				onCreate={commitCreate}
				onRename={commitRename}
				onCancelCreate={() => (createTarget = null)}
				onCancelRename={() => (renameTarget = null)}
			/>
		</div>
	</div>
	<div class="footer">
		<span class="count">{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
		<span class="sp"></span>
		<AppActions />
	</div>
	{#if menu}
		<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = null)} />
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
	.tree.drop-root {
		background: var(--hover);
		box-shadow: inset 0 0 0 1px var(--accent);
		border-radius: var(--r);
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
</style>
