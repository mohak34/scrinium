<script lang="ts">
	import { searchNotes, type SearchResult } from '$lib/stores/vault';
	import { createRequest, focusSearchRequest } from '$lib/stores/actions';
	import { signOut } from '$lib/auth-client';

	interface Props {
		onSelect: (path: string) => void;
		onClose: () => void;
		onToggleSidebar: () => void;
	}
	let { onSelect, onClose, onToggleSidebar }: Props = $props();

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
		{ label: 'Sign out', hint: 'End this session', run: () => signOut() },
		{ label: 'Bold', hint: `${mod}B` },
		{ label: 'Italic', hint: `${mod}I` },
		{ label: 'Strikethrough', hint: `${mod}Shift+X` },
		{ label: 'Inline code', hint: `${mod}\`` },
		{ label: 'Heading 1', hint: `${mod}1` },
		{ label: 'Heading 2', hint: `${mod}2` },
		{ label: 'Heading 3', hint: `${mod}3` },
		{ label: 'Heading 4', hint: `${mod}4` },
		{ label: 'Heading 5', hint: `${mod}5` },
		{ label: 'Heading 6', hint: `${mod}6` },
		{ label: 'Toggle bullet list', hint: `${mod}Shift+B` },
		{ label: 'Find in note', hint: `${mod}F` },
		{ label: 'Find & replace', hint: `${mod}H` },
		{ label: 'Full preview', hint: 'Esc' },
		{ label: 'Open command palette', hint: `${mod}K` }
	];

	type PaletteItem = { kind: 'command'; item: Command } | { kind: 'note'; item: SearchResult };

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let selected = $state(0);
	let inputEl = $state<HTMLInputElement>();
	let listEl = $state<HTMLDivElement>();

	$effect(() => {
		inputEl?.focus();
	});

	$effect(() => {
		const q = query.trim();
		loading = q.length >= 2;
		const timer = setTimeout(async () => {
			const res = await searchNotes(q);
			if (query.trim() === q) {
				results = res;
				loading = false;
			}
		}, 120);
		return () => clearTimeout(timer);
	});

	const filteredCommands = $derived(() => {
		const q = query.trim().toLowerCase();
		return commands.filter(
			(c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)
		);
	});

	const items = $derived<PaletteItem[]>([
		...filteredCommands().map((c): PaletteItem => ({ kind: 'command', item: c })),
		...results.map((r): PaletteItem => ({ kind: 'note', item: r }))
	]);

	$effect(() => {
		if (selected >= items.length) selected = 0;
	});

	$effect(() => {
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
				<div class="item muted">No results</div>
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
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 15vh;
	}
	.palette {
		width: min(520px, 90vw);
		background: #1c1e26;
		border: 1px solid #2a2d38;
		border-radius: 10px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	.palette-input {
		width: 100%;
		background: none;
		border: none;
		border-bottom: 1px solid #2a2d38;
		color: #e6e6e6;
		padding: 0.9rem 1rem;
		font-size: 1rem;
		outline: none;
	}
	.list {
		max-height: 320px;
		overflow-y: auto;
		padding: 0.25rem;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: #c9cbd6;
		padding: 0.55rem 0.7rem;
		border-radius: 6px;
		cursor: pointer;
	}
	.item.selected {
		background: #2a3350;
	}
	.item.muted {
		cursor: default;
		color: #6b6e7a;
	}
	.label {
		font-size: 0.9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hint {
		font-size: 0.72rem;
		color: #6b6e7a;
		flex-shrink: 0;
	}
</style>
