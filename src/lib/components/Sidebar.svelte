<script lang="ts">
	import { onMount } from 'svelte';
	import FileTree from './FileTree.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import SearchBox from './SearchBox.svelte';
	import Backlinks from './Backlinks.svelte';
	import {
		tree,
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
		dragPath,
		dragKind,
		dropRoot,
		canDrop
	} from '$lib/stores/filetree';
	import { goto } from '$app/navigation';
	import { createRequest, renameRequest } from '$lib/stores/actions';
	import { signOut } from '$lib/auth-client';

	interface Props {
		onSelect: (path: string) => void;
		onOpenAsset: (path: string) => void;
	}
	let { onSelect, onOpenAsset }: Props = $props();

	let menu = $state<{ x: number; y: number; entry: VaultEntry | null } | null>(null);
	let addMenu = $state<{ x: number; y: number } | null>(null);
	let createTarget = $state<{ parent: string | null; kind: 'note' | 'folder' } | null>(null);
	let renameTarget = $state<{ path: string } | null>(null);

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
		<span class="brand">Scrinium</span>
		<button
			class="icon-btn"
			onclick={(e) => (addMenu = { x: e.clientX, y: e.clientY })}
			title="New note or folder"
		>
			<span class="material-symbols-outlined">add</span>
		</button>
	</div>
	<SearchBox {onSelect} />
	<div
		class="tree"
		class:drop-root={$dropRoot}
		role="group"
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
	<Backlinks {onSelect} />
	<div class="footer">
		<button class="footer-item" onclick={() => goto('/trash')}>
			<span class="material-symbols-outlined">delete</span>
			<span>Trash</span>
		</button>
		<button class="footer-item" onclick={() => goto('/settings')}>
			<span class="material-symbols-outlined">settings</span>
			<span>Settings</span>
		</button>
		<button class="footer-item" onclick={signOut}>
			<span class="material-symbols-outlined">logout</span>
			<span>Sign out</span>
		</button>
	</div>
	{#if menu}
		<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = null)} />
	{/if}
	{#if addMenu}
		<ContextMenu
			x={addMenu.x}
			y={addMenu.y}
			items={[
				{ label: 'New note', action: () => (createTarget = { parent: null, kind: 'note' }) },
				{ label: 'New folder', action: () => (createTarget = { parent: null, kind: 'folder' }) }
			]}
			onClose={() => (addMenu = null)}
		/>
	{/if}
</aside>

<style>
	aside {
		width: 100%;
		flex-shrink: 0;
		background: #15161c;
		border-right: 1px solid var(--border-default);
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 48px;
		padding: 0 var(--gutter);
		flex-shrink: 0;
	}
	.brand {
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		font-weight: var(--font-editor-title-weight);
		letter-spacing: var(--font-editor-title-tracking);
		color: var(--on-surface);
	}
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface-variant);
		cursor: pointer;
		line-height: 1;
	}
	.icon-btn:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.tree {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem 0;
	}
	.tree.drop-root {
		background: var(--surface-container-low);
		box-shadow: inset 0 0 0 1px var(--primary);
	}
	.footer {
		padding: var(--panel-padding);
		border-top: 1px solid var(--border-default);
		flex-shrink: 0;
	}
	.footer-item {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		width: 100%;
		height: 28px;
		padding: 0 8px;
		background: none;
		border: none;
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-small);
		cursor: pointer;
		text-align: left;
	}
	.footer-item:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
</style>
