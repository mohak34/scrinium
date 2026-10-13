<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import { searchNotes, flushSave, openTab, type SearchResult } from '$lib/stores/vault';
	import { startCreate } from '$lib/stores/actions';
	import { openSettings, type SettingsPage } from '$lib/stores/settingsDialog';
	import { openBins } from '$lib/stores/bins';
	import { settings } from '$lib/stores/settings';
	import { pageCommands, shortcutHelpOpen, type PaletteCommand } from '$lib/stores/palette';
	import {
		tasks,
		projects,
		loadTasks,
		loadProjects,
		createTask,
		openTask,
		type Task
	} from '$lib/stores/tasks';
	import { projectName, statusMeta } from '$lib/taskModel';
	import { APPS } from '$lib/apps';
	import { signOut } from '$lib/auth-client';

	// Mounted once in the root layout, so it works on every app page. Notes
	// and tasks are searchable from anywhere; picking one switches app.
	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	const onTasksPage = () => page.url.pathname.startsWith('/tasks');

	async function go(href: string) {
		if (page.url.pathname === href && !page.url.search) return;
		await flushSave();
		await goto(href);
	}

	async function openNote(path: string) {
		await flushSave();
		openTab(path);
		if (page.url.pathname !== '/') await goto('/');
	}

	function showTask(id: string) {
		openTask(id);
		if (!onTasksPage()) void go('/tasks');
	}

	async function addTask(title: string) {
		const row = await createTask({ title });
		if (row && onTasksPage()) openTask(row.id);
	}

	const SETTINGS: [SettingsPage, string, string][] = [
		['editor', 'Editor', 'Font size, line numbers, wrap'],
		['keyboard', 'Keyboard', 'Vim motions and every shortcut'],
		['attachments', 'Attachments', 'Where pasted files land'],
		['account', 'Account', 'Google Calendar connection'],
		['devices', 'Devices', 'Phone tokens'],
		['agents', 'Agents', 'MCP URL and agent tokens'],
		['about', 'About', 'Version and links']
	];

	// Global commands: everything that works without a particular page open.
	const globalCommands = $derived<PaletteCommand[]>([
		{
			label: 'New note',
			hint: 'Create a note at the vault root',
			run: () => void startCreate('note')
		},
		{
			label: 'New folder',
			hint: 'Create a folder at the vault root',
			run: () => void startCreate('folder')
		},
		...APPS.map((a, i) => ({
			label: `Go to ${a.label}`,
			hint: `Ctrl+Shift+${i + 1}`,
			run: () => void go(a.href)
		})),
		...$projects.map((p) => ({
			label: `Open project ${projectName(p.path)}`,
			hint: p.path,
			run: () => void go(`/tasks/kanban?project=${encodeURIComponent(p.path)}`)
		})),
		{ label: 'Open archive', hint: 'Browse, search and unarchive notes', run: () => openBins('archive') },
		{ label: 'Open trash', hint: 'View and restore deleted notes', run: () => openBins('trash') },
		{
			label: 'Review stale notes',
			hint: 'Old notes nothing links to, to archive or trash',
			run: () => openBins('review')
		},
		...SETTINGS.map(([key, name, hint]) => ({
			label: `Settings: ${name}`,
			hint,
			run: () => openSettings(key)
		})),
		{ label: 'Keyboard shortcuts', hint: '?', run: () => shortcutHelpOpen.set(true) },
		{
			label: $settings.editor.vimMotions ? 'Turn vim motions off' : 'Turn vim motions on',
			hint: 'Editor and single-key shortcuts',
			run: () =>
				settings.update((s) => ({
					...s,
					editor: { ...s.editor, vimMotions: !s.editor.vimMotions }
				}))
		},
		{ label: 'Sign out', hint: 'End this session', run: () => signOut() }
	]);

	type PaletteItem =
		| { kind: 'command'; item: PaletteCommand }
		| { kind: 'note'; item: SearchResult }
		| { kind: 'task'; item: Task }
		| { kind: 'add'; title: string };

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
	// Tasks and projects only load on the task pages; fetch fresh ones here
	// so they are searchable from Notes too.
	$effect(() => {
		void searchNotes('').then((r) => (recents = r));
		void loadTasks();
		void loadProjects();
	});

	// Hand focus back on close (the editor, usually), unless the command
	// moved it somewhere else, like the rename input or the search box.
	$effect(() => {
		const prev = document.activeElement;
		return () =>
			setTimeout(() => {
				if (
					prev instanceof HTMLElement &&
					prev !== document.body &&
					prev.isConnected &&
					(document.activeElement === document.body || document.activeElement === null)
				) {
					prev.focus();
				}
			});
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

	// The page's own commands first: they are what you most likely want there.
	const commands = $derived([...$pageCommands, ...globalCommands]);

	const queryEmpty = $derived(query.trim().length === 0);

	const matches = (text: string, q: string) => text.toLowerCase().includes(q);

	// Tasks match by title, open ones first. Capped so notes still show.
	const taskHits = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2) return [];
		return $tasks
			.filter((t) => matches(t.title, q))
			.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))
			.slice(0, 8);
	});

	const items = $derived.by<PaletteItem[]>(() => {
		const q = query.trim().toLowerCase();
		if (queryEmpty)
			return [
				...recents.map((r): PaletteItem => ({ kind: 'note', item: r })),
				...commands.map((c): PaletteItem => ({ kind: 'command', item: c }))
			];
		return [
			...commands
				.filter((c) => matches(c.label, q) || matches(c.hint, q))
				.map((c): PaletteItem => ({ kind: 'command', item: c })),
			...results.map((r): PaletteItem => ({ kind: 'note', item: r })),
			...taskHits.map((t): PaletteItem => ({ kind: 'task', item: t })),
			// Held back until notes answer, so a quick Enter never adds a task
			// when a note was meant.
			...(pending ? [] : [{ kind: 'add', title: query.trim() } as const])
		];
	});

	function itemKey(it: PaletteItem): string {
		if (it.kind === 'note') return 'n:' + it.item.path;
		if (it.kind === 'task') return 't:' + it.item.id;
		if (it.kind === 'add') return 'add';
		return 'c:' + it.item.label;
	}

	function itemLabel(it: PaletteItem): string {
		if (it.kind === 'note') return it.item.title || it.item.path;
		if (it.kind === 'task') return it.item.title;
		if (it.kind === 'add') return `Add task "${it.title}"`;
		return it.item.label;
	}

	function itemHint(it: PaletteItem): string {
		if (it.kind === 'note') return it.item.path;
		if (it.kind === 'task') {
			const status = statusMeta(it.item.status).label;
			return it.item.project ? `${status} · ${projectName(it.item.project)}` : status;
		}
		if (it.kind === 'add') return 'New task in Inbox';
		return it.item.hint;
	}

	$effect(() => {
		if (selected >= items.length) selected = 0;
	});

	$effect(() => {
		const sel = selected;
		const el = listEl?.querySelector<HTMLElement>('.item.selected');
		el?.scrollIntoView({ block: 'nearest' });
	});

	function run(it: PaletteItem) {
		if (it.kind === 'command') it.item.run();
		else if (it.kind === 'note') void openNote(it.item.path);
		else if (it.kind === 'task') showTask(it.item.id);
		else void addTask(it.title);
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
			placeholder="Search notes and tasks, or run a command…"
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
				{#each items as it, i (itemKey(it))}
					<button
						class="item"
						class:selected={i === selected}
						onmouseenter={() => (selected = i)}
						onmousedown={(e) => {
							e.preventDefault();
							run(it);
						}}
					>
						<span class="label">{itemLabel(it)}</span>
						<span class="hint">{itemHint(it)}</span>
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
		background: var(--scrim);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 13vh;
	}
	.palette {
		width: min(600px, 92vw);
		background: var(--panel);
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	.palette-input {
		width: 100%;
		height: 52px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--line);
		color: var(--text);
		font: var(--fs-lg) var(--font-ui);
		padding: 0 18px;
		outline: none;
	}
	.palette-input::placeholder {
		color: var(--text-3);
	}
	.list {
		max-height: 380px;
		overflow-y: auto;
		padding: 6px;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		min-height: 38px;
		text-align: left;
		background: none;
		border: none;
		color: var(--text-2);
		padding: 0 12px;
		border-radius: var(--r-md);
		cursor: pointer;
	}
	.item.selected {
		background: var(--hover);
	}
	.item.muted {
		cursor: default;
		color: var(--text-3);
	}
	.label {
		font-size: var(--fs-md);
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--text-3);
		flex-shrink: 0;
	}
</style>
