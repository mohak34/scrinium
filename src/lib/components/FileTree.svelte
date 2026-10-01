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

	// Notes under a folder, shown as a quiet count on the folder row.
	function noteCount(e: VaultEntry): number {
		let n = 0;
		for (const c of e.children ?? []) n += c.type === 'directory' ? noteCount(c) : c.name.endsWith('.md') ? 1 : 0;
		return n;
	}
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
						data-tree-entry
						data-path={entry.path}
						data-type="directory"
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
						<span class="material-symbols-outlined file-chevron"
							>{$collapsedDirs.has(entry.path) ? 'chevron_right' : 'expand_more'}</span
						>
						<span class="file-label">{entry.name}</span>
						{#if noteCount(entry) > 0}<span class="count">{noteCount(entry)}</span>{/if}
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
					data-tree-entry
					data-path={entry.path}
					data-type="file"
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
					<span class="file-label">{entry.name.replace(/\.md$/, '')}</span>
					{#if $pinnedPaths.includes(entry.path)}
						<span class="material-symbols-outlined pin-mark" title="Pinned">keep</span>
					{/if}
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
					data-tree-entry
					data-path={entry.path}
					data-type="file"
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
		padding: 0;
		position: relative;
	}
	/* Indent guide for nested levels, aligned under the parent chevron. */
	ul:not([style*='--depth: 0'])::before {
		content: '';
		position: absolute;
		left: calc(var(--depth) * 16px + 1px);
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--line-2);
		pointer-events: none;
	}
	.dir,
	.file {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 29px;
		padding: 0 8px 0 calc(8px + var(--depth, 0) * 16px);
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
	}
	.dir {
		color: var(--text);
	}
	.file {
		padding-left: calc(30px + var(--depth, 0) * 16px);
	}
	.dir:hover,
	.file:hover {
		background: var(--hover);
		color: var(--text);
	}
	.dir.drop-target {
		background: var(--accent-dim);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.dir.dragging,
	.file.dragging {
		opacity: 0.4;
	}
	.file-chevron {
		font-size: 18px;
		color: var(--text-3);
	}
	.file-icon {
		font-size: 16px;
		color: var(--text-3);
	}
	.file.asset {
		padding-left: calc(10px + var(--depth, 0) * 16px);
	}
	.count {
		margin-left: auto;
		padding-left: 8px;
		font-size: var(--fs-xs);
		color: var(--text-3);
	}
	.pin-mark {
		margin-left: auto;
		font-size: 14px;
		color: var(--text-3);
	}
	.file.active {
		background: var(--accent-dim);
		color: var(--text);
	}
	.file.active .pin-mark {
		color: var(--accent);
	}
	.file-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file.asset {
		cursor: default;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.file.asset:hover {
		background: none;
		color: var(--text-3);
	}
	.file.asset.viewable {
		cursor: pointer;
		color: var(--text-2);
	}
	.file.asset.viewable:hover {
		background: var(--hover);
	}
	.rename-input {
		display: block;
		margin: 1px 0 1px calc(8px + var(--depth, 0) * 16px);
		width: calc(100% - 8px - var(--depth, 0) * 16px);
		height: 27px;
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: var(--r);
		color: var(--text);
		padding: 0 8px;
		font: var(--fs) var(--font-ui);
		outline: none;
	}
</style>
