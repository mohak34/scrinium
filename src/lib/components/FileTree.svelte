<script lang="ts">
	import type { VaultEntry } from '$lib/stores/vault';
	import { activePath } from '$lib/stores/vault';
	import { collapsedDirs, toggleDir } from '$lib/stores/filetree';
	import FileTree from './FileTree.svelte';

	interface Props {
		entries: VaultEntry[];
		onSelect: (path: string) => void;
		onContextMenu: (entry: VaultEntry, x: number, y: number) => void;
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
		onContextMenu,
		dirPath = null,
		depth = 0,
		createTarget = null,
		renameTarget = null,
		onCreate,
		onRename,
		onCancelCreate,
		onCancelRename
	}: Props = $props();

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
				<div
					class="dir"
					role="button"
					tabindex="0"
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
				>
					<span class="chevron">{$collapsedDirs.has(entry.path) ? '▸' : '▾'}</span>
					{entry.name}
				</div>
				{#if !$collapsedDirs.has(entry.path)}
					<FileTree
						entries={entry.children ?? []}
						{onSelect}
						{onContextMenu}
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
			{:else}
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
					<button
						class="file"
						class:active={$activePath === entry.path}
						onclick={() => onSelect(entry.path)}
						oncontextmenu={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onContextMenu(entry, e.clientX, e.clientY);
						}}
					>
						{entry.name.replace(/\.md$/, '')}
					</button>
				{/if}
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
	.file.active {
		background: #2a3350;
		color: #fff;
	}
	.rename-input {
		width: 100%;
		background: #14151a;
		border: 1px solid #4f7cff;
		border-radius: 5px;
		color: #e6e6e6;
		padding: 0.3rem 0.5rem;
		font-size: 0.85rem;
		outline: none;
	}
</style>
