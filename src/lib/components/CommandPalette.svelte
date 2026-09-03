<script lang="ts">
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { searchNotes, activePath, downloadNote, type SearchResult } from '$lib/stores/vault';
	import { createRequest, focusSearchRequest } from '$lib/stores/actions';
	import { signOut } from '$lib/auth-client';

	interface Props {
		onSelect: (path: string) => void;
		onClose: () => void;
		onToggleSidebar: () => void;
		onCommand: (cmd: string) => void;
	}
	let { onSelect, onClose, onToggleSidebar, onCommand }: Props = $props();

	const mod =
		typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

	interface Command {
		label: string;
		hint: string;
		run?: () => void;
	}

	const commands: Command[] = [
		{
			label: 'New note',
			hint: 'Create a note at the vault root',
			run: () => createRequest.set({ parent: null, kind: 'note' })
		},
		{
			label: 'New folder',
			hint: 'Create a folder at the vault root',
			run: () => createRequest.set({ parent: null, kind: 'folder' })
		},
		{
			label: 'Open search',
			hint: 'Jump to the sidebar search box',
			run: () => focusSearchRequest.update((n) => n + 1)
		},
		{
			label: 'Toggle sidebar',
			hint: 'Collapse or expand the sidebar',
			run: () => onToggleSidebar()
		},
		{
			label: 'Open trash',
			hint: 'View and restore deleted notes',
			run: () => goto('/trash')
		},
		{
			label: 'Open settings',
			hint: 'Configure editor and account',
			run: () => goto('/settings')
		},
		{ label: 'Sign out', hint: 'End this session', run: () => signOut() },
		{
			label: 'Bold',
			hint: `${mod}B`,
			run: () => onCommand('bold')
		},
		{
			label: 'Italic',
			hint: `${mod}I`,
			run: () => onCommand('italic')
		},
		{
			label: 'Strikethrough',
			hint: `${mod}Shift+X`,
			run: () => onCommand('strike')
		},
		{
			label: 'Inline code',
			hint: `${mod}\``,
			run: () => onCommand('code')
		},
		{ label: 'Heading 1', hint: `${mod}1`, run: () => onCommand('h1') },
		{ label: 'Heading 2', hint: `${mod}2`, run: () => onCommand('h2') },
		{ label: 'Heading 3', hint: `${mod}3`, run: () => onCommand('h3') },
		{ label: 'Heading 4', hint: `${mod}4`, run: () => onCommand('h4') },
		{ label: 'Heading 5', hint: `${mod}5`, run: () => onCommand('h5') },
		{ label: 'Heading 6', hint: `${mod}6`, run: () => onCommand('h6') },
		{
			label: 'Toggle bullet list',
			hint: `${mod}Shift+B`,
			run: () => onCommand('bullet')
		},
		{
			label: 'Toggle task checkbox',
			hint: `${mod}L`,
			run: () => onCommand('task')
		},
		{
			label: 'Remove task checkbox',
			hint: `${mod}Shift+L`,
			run: () => onCommand('removeTask')
		},
		{ label: 'Find in note', hint: `${mod}F`, run: () => onCommand('find') },
		{ label: 'Find & replace', hint: `${mod}H`, run: () => onCommand('replace') },
		{
			label: 'Download note as Markdown',
			hint: 'Save the open note as a .md file',
			run: () => {
				const p = get(activePath);
				if (p) void downloadNote(p).catch(() => {});
			}
		},
		{
			label: 'Math inline',
			hint: `${mod}M`,
			run: () => onCommand('mathInline')
		},
		{
			label: 'Math block',
			hint: `${mod}Shift+E`,
			run: () => onCommand('mathBlock')
		},
		{ label: 'Full preview', hint: 'Esc', run: () => onCommand('preview') },
		{ label: 'Open command palette', hint: `${mod}K` }
	];

	type PaletteItem = { kind: 'command'; item: Command } | { kind: 'note'; item: SearchResult };

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let pending = $state(false);
	let selected = $state(0);
	let inputEl = $state<HTMLInputElement>();
	let listEl = $state<HTMLDivElement>();

	// Recents turn Cmd+K into a launcher: the server returns recently edited
	// notes for a blank query, so the palette opens on your notes first.
	let recents = $state<SearchResult[]>([]);
	$effect(() => {
		void searchNotes('').then((r) => (recents = r));
	});

	$effect(() => {
		inputEl?.focus();
	});

	$effect(() => {
		// No debounce: the search is a local SQLite query, so fire immediately on
		// every keystroke. The guard below discards out-of-order responses. A
		// "Searching…" row only appears if a request is genuinely slow (>250ms).
		const q = query.trim();
		results = [];
		pending = true;
		loading = false;
		if (q.length < 2) {
			pending = false;
			return;
		}
		const slowTimer = setTimeout(() => {
			loading = true;
		}, 250);
		void searchNotes(q).then((res) => {
			if (query.trim() === q) {
				results = res;
				pending = false;
				loading = false;
				clearTimeout(slowTimer);
			}
		});
		return () => clearTimeout(slowTimer);
	});

	const filteredCommands = $derived(() => {
		const q = query.trim().toLowerCase();
		return commands.filter(
			(c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)
		);
	});

	const queryEmpty = $derived(query.trim().length === 0);

	const items = $derived<PaletteItem[]>(
		queryEmpty
			? [
					...recents.map((r): PaletteItem => ({ kind: 'note', item: r })),
					...commands.map((c): PaletteItem => ({ kind: 'command', item: c }))
				]
			: [
					...filteredCommands().map((c): PaletteItem => ({ kind: 'command', item: c })),
					...results.map((r): PaletteItem => ({ kind: 'note', item: r }))
				]
	);

	$effect(() => {
		if (selected >= items.length) selected = 0;
	});

	$effect(() => {
		const sel = selected;
		const el = listEl?.querySelector<HTMLElement>('.item.selected');
		el?.scrollIntoView({ block: 'nearest' });
	});

	function run(item: PaletteItem) {
		if (item.kind === 'command') item.item.run?.();
		else onSelect(item.item.path);
		onClose();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(items.length - 1, selected + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(0, selected - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (items.length) run(items[selected]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<div class="overlay" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onClose()}>
	<div class="palette" role="dialog" aria-label="Command palette">
		<input
			bind:this={inputEl}
			class="palette-input"
			placeholder="Search notes or run a command…"
			bind:value={query}
			onkeydown={onKeyDown}
		/>
		<div class="list" bind:this={listEl}>
			{#if loading}
				<div class="item muted">Searching…</div>
			{:else if items.length === 0}
				{#if !pending}
					<div class="item muted">No results</div>
				{/if}
			{:else}
				{#each items as it, i (it.kind === 'note' ? it.item.path : it.item.label)}
					<button
						class="item"
						class:selected={i === selected}
						onmouseenter={() => (selected = i)}
						onmousedown={(e) => {
							e.preventDefault();
							run(it);
						}}
					>
						<span class="label">
							{it.kind === 'note' ? it.item.title || it.item.path : it.item.label}
						</span>
						<span class="hint">{it.kind === 'note' ? it.item.path : it.item.hint}</span>
					</button>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: var(--overlay);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 15vh;
	}
	.palette {
		width: min(520px, 90vw);
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
	}
	.palette-input {
		width: 100%;
		background: none;
		border: none;
		border-bottom: 1px solid var(--border-default);
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-medium);
		padding: 12px var(--panel-padding);
		outline: none;
	}
	.palette-input::placeholder {
		color: var(--on-surface-variant);
	}
	.list {
		max-height: 320px;
		overflow-y: auto;
		padding: 4px;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--stack-gap);
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		padding: 8px 12px;
		border-radius: var(--radius);
		cursor: pointer;
	}
	.item.selected {
		background: var(--surface-container-high);
	}
	.item.selected .label {
		color: var(--on-surface);
	}
	.item.muted {
		cursor: default;
		color: var(--outline);
	}
	.label {
		font-size: var(--font-ui-medium);
		color: var(--on-surface);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hint {
		font-size: var(--font-ui-micro);
		color: var(--outline);
		flex-shrink: 0;
	}
</style>
