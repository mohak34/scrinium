<script lang="ts">
	import FileTree from './FileTree.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import {
		tree,
		createNote,
		createFolder,
		renamePath,
		deletePath,
		movePath,
		type VaultEntry
	} from '$lib/stores/vault';
	import {
		expandDir,
		dragPath,
		dropRoot,
		canDrop,
		clearDragState
	} from '$lib/stores/filetree';
	import { signOut } from '$lib/auth-client';

	interface Props {
		onSelect: (path: string) => void;
	}
	let { onSelect }: Props = $props();

	let menu = $state<{ x: number; y: number; entry: VaultEntry | null } | null>(null);
	let createTarget = $state<{ parent: string | null; kind: 'note' | 'folder' } | null>(null);
	let renameTarget = $state<{ entry: VaultEntry } | null>(null);

	function sanitizeName(raw: string, kind: 'note' | 'folder'): string | null {
		let name = raw.trim().replace(/[\\/:*?"<>|]/g, '');
		if (!name || name === '.' || name === '..' || name.startsWith('.')) return null;
		if (kind === 'note' && !name.endsWith('.md')) name += '.md';
		return name;
	}

	function joinPath(parent: string | null, name: string) {
		return parent ? `${parent}/${name}` : name;
	}

	async function commitCreate(parent: string | null, kind: 'note' | 'folder', rawName: string) {
		const name = sanitizeName(rawName, kind);
		if (!name) {
			createTarget = null;
			return;
		}
		const path = joinPath(parent, name);
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
		const kind = renameTarget?.entry.type === 'directory' ? 'folder' : 'note';
		const name = sanitizeName(rawName, kind);
		if (name) {
			const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
			const newPath = joinPath(parent, name);
			if (newPath !== path) await renamePath(path, newPath);
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
		if (canDrop($dragPath, null)) dropRoot.set(true);
	}

	function rootDrop(e: DragEvent) {
		e.preventDefault();
		dropRoot.set(false);
		const source = $dragPath;
		dragPath.set(null);
		if (source && canDrop(source, null)) void onMove(source, null);
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
			return [
				{ label: 'Rename', action: () => (renameTarget = { entry }) },
				{ label: 'Delete', danger: true, action: () => void deletePath(entry.path) }
			];
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
			{ label: 'Rename', action: () => (renameTarget = { entry }) },
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
			onclick={() => (createTarget = { parent: null, kind: 'note' })}
			title="New note"
		>
			+
		</button>
	</div>
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
	<div class="footer">
		<button class="signout" onclick={signOut}>Sign out</button>
	</div>
	{#if menu}
		<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = null)} />
	{/if}
</aside>

<style>
	aside {
		width: 100%;
		flex-shrink: 0;
		background: #191a21;
		border-right: 1px solid #24262f;
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 0.9rem 0.6rem;
	}
	.brand {
		font-weight: 600;
		font-size: 0.95rem;
		color: #e6e6e6;
	}
	.icon-btn {
		background: #24262f;
		border: none;
		color: #c9cbd6;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
	}
	.icon-btn:hover {
		background: #2e313d;
	}
	.tree {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem;
	}
	.tree.drop-root {
		background: #1b1e27;
		box-shadow: inset 0 0 0 1px #4f7cff;
	}
	.footer {
		padding: 0.6rem;
		border-top: 1px solid #24262f;
	}
	.signout {
		background: none;
		border: none;
		color: #6b6e7a;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0.3rem 0.4rem;
	}
	.signout:hover {
		color: #c9cbd6;
	}
</style>
