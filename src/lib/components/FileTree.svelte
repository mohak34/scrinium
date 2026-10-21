<script lang="ts">
	import type { VaultEntry } from '$lib/stores/vault';
	import { activePath, pinnedPaths } from '$lib/stores/vault';
	import { collapsedDirs, toggleDir } from '$lib/stores/filetree';
	import { drag } from './sidebarDrag';
	import FileTree from './FileTree.svelte';

	interface Props {
		entries: VaultEntry[];
		onSelect: (path: string) => void;
		onOpenAsset: (path: string) => void;
		onContextMenu: (entry: VaultEntry, x: number, y: number) => void;
		onDragStart: (e: PointerEvent, entry: VaultEntry) => void;
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
		onDragStart,
		dirPath = null,
		depth = 0,
		createTarget = null,
		renameTarget = null,
		onCreate,
		onRename,
		onCancelCreate,
		onCancelRename
	}: Props = $props();

	// The row being dragged fades in place; the folder a drop would land in is
	// highlighted with everything under it.
	const dragged = $derived($drag && !$drag.source.fromPins ? $drag.source.path : null);
	const dropDir = $derived($drag?.target?.kind === 'move' ? $drag.target.dir : undefined);

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
	// Pinned notes live in the Pinned list only, so each note shows once.
	const display = $derived(entries.filter((e) => !$pinnedPaths.includes(e.path)));

	// Notes under a folder, shown as a quiet count on the folder row. Pinned
	// notes are left out, matching what the folder shows when expanded.
	function noteCount(e: VaultEntry): number {
		let n = 0;
		for (const c of e.children ?? [])
			n += c.type === 'directory' ? noteCount(c) : c.name.endsWith('.md') && !$pinnedPaths.includes(c.path) ? 1 : 0;
		return n;
	}
</script>

<ul style="--depth: {depth}">
	{#each display as entry (entry.path)}
		<li class:drop-target={entry.type === 'directory' && dropDir === entry.path}>
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
						class:dragging={dragged === entry.path}
						role="button"
						tabindex="0"
						data-tree-entry
						data-path={entry.path}
						data-type="directory"
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
						onpointerdown={(e) => onDragStart(e, entry)}
					>
						<span class="material-symbols-outlined file-chevron"
							>{$collapsedDirs.has(entry.path) ? 'chevron_right' : 'expand_more'}</span
						>
						<span class="material-symbols-outlined fill dir-icon"
							>{$collapsedDirs.has(entry.path) ? 'folder' : 'folder_open'}</span
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
						{onDragStart}
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
					class:dragging={dragged === entry.path}
					data-tree-entry
					data-path={entry.path}
					data-type="file"
					onclick={() => onSelect(entry.path)}
					oncontextmenu={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onContextMenu(entry, e.clientX, e.clientY);
					}}
					onpointerdown={(e) => onDragStart(e, entry)}
				>
					<span class="file-label">{entry.name.replace(/\.md$/, '')}</span>
				</button>
			{:else}
				{@const viewable = /\.(png|jpe?g|gif|webp|pdf)$/i.test(entry.name)}
				<div
					class="file asset"
					class:viewable={viewable}
					class:dragging={dragged === entry.path}
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
					onpointerdown={(e) => onDragStart(e, entry)}
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
				placeholder={t.kind === 'folder' ? 'Folder name' : 'Note name, or folder/'}
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
	/* One level is a chevron plus its gap, so a child's first column (a
	   folder's chevron, an attachment's icon) sits under its parent's folder
	   icon and note names line up with folder icons. */
	ul {
		--step: 23px;
	}
	/* Indent guide for nested levels, aligned under the parent chevron. */
	ul:not([style*='--depth: 0'])::before {
		content: '';
		position: absolute;
		left: calc(var(--depth) * var(--step) - 7px);
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
		padding: 0 8px 0 calc(8px + var(--depth, 0) * var(--step));
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
	/* Folders sit between notes (400) and project headers (700). */
	.dir {
		color: var(--text);
		font-weight: 550;
	}
	.file {
		padding-left: calc(30px + var(--depth, 0) * var(--step));
	}
	.dir:hover,
	.file:hover {
		background: var(--hover);
		color: var(--text);
	}
	li.drop-target {
		border-radius: var(--r);
		background: var(--accent-dim);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	/* Mid-drag the pointer sweeps across rows; only the drop target lights up. */
	:global(html.sidebar-dragging) .dir:hover,
	:global(html.sidebar-dragging) .file:not(.active):hover {
		background: none;
	}
	.dir.dragging,
	.file.dragging {
		opacity: 0.4;
	}
	/* The icon font has one weight; a stroke makes the arrow read bolder. */
	.file-chevron {
		font-size: 17px;
		color: var(--text-2);
		-webkit-text-stroke: 0.6px currentColor;
	}
	.dir-icon {
		font-size: 16px;
		color: var(--text-2);
	}
	.file-icon {
		font-size: 16px;
		color: var(--text-3);
	}
	.file.asset {
		padding-left: calc(8px + var(--depth, 0) * var(--step));
	}
	.count {
		margin-left: auto;
		padding-left: 8px;
		font-size: var(--fs-xs);
		color: var(--text-3);
	}
	.file.active {
		background: var(--accent-dim);
		color: var(--text);
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
		margin: 1px 0 1px calc(8px + var(--depth, 0) * var(--step));
		width: calc(100% - 8px - var(--depth, 0) * var(--step));
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
