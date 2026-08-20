<script lang="ts">
	import type { VaultEntry } from '$lib/stores/vault';
	import { activePath, pinnedPaths, sortPinnedFirst } from '$lib/stores/vault';
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
		renameTarget?: { path: string } | null;
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
			renameName = renameTarget.path.split('/').pop()!.replace(/\.md$/, '');
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
const display = $derived(sortPinnedFirst(entries));
</script>

<ul style="--depth: {depth}">
	{#each display as entry (entry.path)}
		<li>
			{#if entry.type === 'directory'}
				{#if renameTarget?.path === entry.path}
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
						<span
							class="material-symbols-outlined file-chevron"
							>{$collapsedDirs.has(entry.path) ? 'folder' : 'folder_open'}</span
						>
						<span class="file-label">{entry.name}</span>
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
			{:else if renameTarget?.path === entry.path}
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
					class:pinned={$pinnedPaths.includes(entry.path)}
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
					<span class="material-symbols-outlined file-icon">
						{$pinnedPaths.includes(entry.path) ? 'push_pin' : 'description'}
					</span>
					<span class="file-label">{entry.name.replace(/\.md$/, '')}</span>
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
					<span class="material-symbols-outlined file-icon">{viewable ? 'image' : 'draft'}</span>
					<span class="file-label">{entry.name}</span>
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
		padding-left: calc(var(--depth, 0) * 12px);
	}
	.dir {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		height: 28px;
		padding: 0 var(--stack-gap);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-small);
		cursor: pointer;
		user-select: none;
	}
	.dir:hover {
		background: #1d1f28;
		color: var(--on-surface);
	}
	.dir.drop-target {
		background: #242840;
		box-shadow: inset 0 0 0 1px var(--primary);
		color: var(--on-surface);
	}
	.dir.dragging,
	.file.dragging {
		opacity: 0.4;
	}
	.file-chevron,
	.file-icon {
		flex-shrink: 0;
		font-size: 16px;
		transition: opacity 0.12s ease;
	}
	.dir .file-chevron {
		color: var(--on-surface-variant);
		opacity: 0.4;
	}
	.dir:hover .file-chevron {
		opacity: 1;
	}
	.file {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		width: 100%;
		height: 28px;
		text-align: left;
		background: none;
		border: none;
		color: var(--on-surface-variant);
		padding: 0 var(--stack-gap);
		border-radius: var(--radius);
		font-size: var(--font-ui-small);
		font-family: var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file .file-icon {
		color: var(--on-surface-variant);
		opacity: 0.6;
	}
	.file:hover {
		background: #1d1f28;
		color: var(--on-surface);
	}
	.file.active {
		background: #242840;
		color: var(--on-surface);
		font-size: var(--font-ui-medium);
	}
	.file.active::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--primary);
	}
	.file.active .file-icon {
		color: var(--primary);
		opacity: 1;
	}
	.file.pinned .file-icon {
		color: var(--primary);
		opacity: 0.9;
	}
	.file-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file.asset {
		cursor: default;
		color: var(--outline);
		font-size: var(--font-ui-micro);
	}
	.file.asset:hover {
		background: none;
	}
	.file.asset .file-icon {
		opacity: 0.4;
	}
	.file.asset.viewable {
		cursor: pointer;
		color: var(--on-surface-variant);
	}
	.file.asset.viewable:hover {
		background: #1d1f28;
	}
	.rename-input {
		margin-left: var(--stack-gap);
		width: calc(100% - var(--stack-gap));
		background: var(--background);
		border: 1px solid var(--primary);
		border-radius: var(--radius);
		color: var(--on-surface);
		padding: 4px var(--stack-gap);
		font-size: var(--font-ui-small);
		outline: none;
	}
</style>
