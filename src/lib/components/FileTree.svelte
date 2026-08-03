<script lang="ts">
	import type { VaultEntry } from '$lib/stores/vault';
	import { activePath } from '$lib/stores/vault';
	import {
		collapsedDirs,
		toggleDir,
		dragPath,
		dragKind,
		dropDir,
		dropRoot,
		canDrop,
		clearDragState
	} from '$lib/stores/filetree';
	import FileTree from './FileTree.svelte';

	interface Props {
		entries: VaultEntry[];
		onSelect: (path: string) => void;
		onOpenAsset: (path: string) => void;
		onContextMenu: (entry: VaultEntry, x: number, y: number) => void;
		onMove: (path: string, toDir: string | null) => void;
		dirPath?: string | null;
		depth?: number;
		createTarget?: { parent: string | null; kind: 'note' | 'folder' } | null;
		renameTarget?: { entry: VaultEntry } | null;
		onCreate: (parent: string | null, kind: 'note' | 'folder', name: string) => void;
		onRename: (path: string, newName: string) => void;
		onCancelCreate: () => void;
		onCancelRename: () => void;
	}
	let {
		entries,
		onSelect,
		onOpenAsset,
		onContextMenu,
		onMove,
		dirPath = null,
		depth = 0,
		createTarget = null,
		renameTarget = null,
		onCreate,
		onRename,
		onCancelCreate,
		onCancelRename
	}: Props = $props();

	function startDrag(e: DragEvent, entry: VaultEntry) {
		dragPath.set(entry.path);
		dragKind.set(entry.type);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', entry.path);
		}
	}

	function endDrag() {
		clearDragState();
	}

	function folderDragOver(e: DragEvent, entry: VaultEntry) {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		if (canDrop($dragPath, entry.path, $dragKind)) dropDir.set(entry.path);
	}

	function folderDragLeave(entry: VaultEntry) {
		if ($dropDir === entry.path) dropDir.set(null);
	}

	function folderDrop(e: DragEvent, entry: VaultEntry) {
		e.preventDefault();
		e.stopPropagation();
		const source = $dragPath;
		const kind = $dragKind;
		dropDir.set(null);
		dropRoot.set(false);
		dragPath.set(null);
		dragKind.set(null);
		if (source && kind && canDrop(source, entry.path, kind)) onMove(source, entry.path);
	}

	let createName = $state('');
	let createInput = $state<HTMLInputElement>();
	let createCommitted = $state(false);

	let renameName = $state('');
	let renameInput = $state<HTMLInputElement>();
	let renameCommitted = $state(false);

	$effect(() => {
		if (createTarget) {
			createName = '';
			createCommitted = false;
		}
	});
	$effect(() => {
		createInput?.focus();
		createInput?.select();
	});

	$effect(() => {
		if (renameTarget) {
			renameName = renameTarget.entry.name.replace(/\.md$/, '');
			renameCommitted = false;
		}
	});
	$effect(() => {
		renameInput?.focus();
		renameInput?.select();
	});

	function commitCreate() {
		if (createCommitted) return;
		createCommitted = true;
		const name = createName.trim();
		if (name) onCreate(dirPath ?? null, createTarget?.kind ?? 'note', name);
		else onCancelCreate();
	}

	function cancelCreate() {
		if (createCommitted) return;
		createCommitted = true;
		onCancelCreate();
	}

	function commitRename(entry: VaultEntry) {
		if (renameCommitted) return;
		renameCommitted = true;
		const name = renameName.trim();
		if (name) onRename(entry.path, name);
		else onCancelRename();
	}

	function cancelRename() {
		if (renameCommitted) return;
		renameCommitted = true;
		onCancelRename();
	}
</script>

<ul style="--depth: {depth}">
	{#each entries as entry (entry.path)}
		<li>
			{#if entry.type === 'directory'}
				{#if renameTarget?.entry.path === entry.path}
					<input
						class="rename-input"
						bind:this={renameInput}
						bind:value={renameName}
						onkeydown={(e) => {
							if (e.key === 'Enter') commitRename(entry);
							if (e.key === 'Escape') cancelRename();
						}}
						onblur={() => commitRename(entry)}
					/>
				{:else}
					<div
						class="dir"
						class:dragging={$dragPath === entry.path}
						class:drop-target={$dropDir === entry.path}
						role="button"
						tabindex="0"
						draggable="true"
						onclick={() => toggleDir(entry.path)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								toggleDir(entry.path);
							}
						}}
						oncontextmenu={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onContextMenu(entry, e.clientX, e.clientY);
						}}
						ondragstart={(e) => startDrag(e, entry)}
						ondragend={endDrag}
						ondragover={(e) => folderDragOver(e, entry)}
						ondragleave={() => folderDragLeave(entry)}
						ondrop={(e) => folderDrop(e, entry)}
					>
						<span class="chevron">{$collapsedDirs.has(entry.path) ? '▸' : '▾'}</span>
						{entry.name}
					</div>
				{/if}
				{#if !$collapsedDirs.has(entry.path)}
					<FileTree
						entries={entry.children ?? []}
						{onSelect}
						{onOpenAsset}
						{onContextMenu}
						{onMove}
						dirPath={entry.path}
						depth={depth + 1}
						{createTarget}
						{renameTarget}
						{onCreate}
						{onRename}
						{onCancelCreate}
						{onCancelRename}
					/>
				{/if}
			{:else if renameTarget?.entry.path === entry.path}
				<input
					class="rename-input"
					bind:this={renameInput}
					bind:value={renameName}
					onkeydown={(e) => {
						if (e.key === 'Enter') commitRename(entry);
						if (e.key === 'Escape') cancelRename();
					}}
					onblur={() => commitRename(entry)}
				/>
			{:else if entry.name.endsWith('.md')}
				<button
					class="file"
					class:active={$activePath === entry.path}
					class:dragging={$dragPath === entry.path}
					draggable="true"
					onclick={() => onSelect(entry.path)}
					oncontextmenu={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onContextMenu(entry, e.clientX, e.clientY);
					}}
					ondragstart={(e) => startDrag(e, entry)}
					ondragend={endDrag}
					ondragover={(e) => {
						e.preventDefault();
						e.stopPropagation();
						if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
					}}
					ondrop={(e) => {
						e.preventDefault();
						e.stopPropagation();
					}}
				>
					{entry.name.replace(/\.md$/, '')}
				</button>
			{:else}
				{@const viewable = /\.(png|jpe?g|gif|webp)$/i.test(entry.name)}
				<div
					class="file asset"
					class:viewable={viewable}
					class:dragging={$dragPath === entry.path}
					draggable="true"
					title={entry.name}
					role="button"
					tabindex={viewable ? 0 : -1}
					onclick={viewable ? () => onOpenAsset(entry.path) : undefined}
					onkeydown={
						viewable
							? (e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onOpenAsset(entry.path);
									}
								}
							: undefined
					}
					oncontextmenu={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onContextMenu(entry, e.clientX, e.clientY);
					}}
					ondragstart={(e) => startDrag(e, entry)}
					ondragend={endDrag}
					ondragover={(e) => {
						e.preventDefault();
						e.stopPropagation();
						if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
					}}
					ondrop={(e) => {
						e.preventDefault();
						e.stopPropagation();
					}}
				>
					{entry.name}
				</div>
			{/if}
		</li>
	{/each}
	{#if createTarget && createTarget.parent === dirPath}
		{@const t = createTarget}
		<li>
			<input
				class="rename-input"
				bind:this={createInput}
				bind:value={createName}
				placeholder={t.kind === 'folder' ? 'Folder name' : 'Note name'}
				onkeydown={(e) => {
					if (e.key === 'Enter') commitCreate();
					if (e.key === 'Escape') cancelCreate();
				}}
				onblur={() => commitCreate()}
			/>
		</li>
	{/if}
</ul>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding-left: calc(var(--depth, 0) * 0.85rem);
	}
	.dir {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b6e7a;
		padding: 0.5rem 0.5rem 0.2rem;
		border-radius: 6px;
		cursor: pointer;
		user-select: none;
	}
	.dir:hover {
		color: #c9cbd6;
	}
	.dir.drop-target {
		background: #2a3350;
		box-shadow: inset 0 0 0 1px #4f7cff;
		border-radius: 6px;
		color: #c9cbd6;
	}
	.dir.dragging,
	.file.dragging {
		opacity: 0.4;
	}
	.chevron {
		font-size: 0.7rem;
		width: 0.9rem;
		text-align: center;
		flex-shrink: 0;
	}
	.file {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: #c9cbd6;
		padding: 0.35rem 0.5rem;
		border-radius: 6px;
		font-size: 0.88rem;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file:hover {
		background: #22242e;
	}
	.file.asset {
		cursor: default;
		color: #8b8e99;
		font-size: 0.8rem;
	}
	.file.asset.viewable {
		cursor: pointer;
		color: #c9cbd6;
	}
	.file.asset.viewable:hover {
		background: #22242e;
	}
	.file.asset:hover {
		background: none;
	}
	.file.active {
		background: #2a3350;
		color: #fff;
	}
	.rename-input {
		margin-left: 0.5rem;
		width: calc(100% - 0.5rem);
		background: #14151a;
		border: 1px solid #4f7cff;
		border-radius: 5px;
		color: #e6e6e6;
		padding: 0.3rem 0.5rem;
		font-size: 0.85rem;
		outline: none;
	}
</style>
