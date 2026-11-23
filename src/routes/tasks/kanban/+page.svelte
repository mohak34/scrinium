<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { usePageCommands } from '$lib/stores/palette';
	import { keyNav, refocusTask } from '$lib/keyNav';
	import {
		tasks,
		loadTasks,
		createTask,
		updateTask,
		deleteTask,
		openTask,
		openTaskId,
		topLevel,
		subtaskCounts,
		isOverdue,
		isDueToday,
		dueLabel,
		stampShort,
		daysSince,
		STALE_DAYS,
		LONG_WAIT_DAYS,
		STATUSES,
		type Task,
		type TaskStatus,
		type TaskUpdate as TaskPatch,
		projects,
		loadProjects,
		removeProject,
		newProjectOpen
	} from '$lib/stores/tasks';
	import { DOING_LIMIT, projectName, selectTasks } from '$lib/taskModel';
	import {
		boardHref,
		colorVar,
		projectLabel,
		projectStyle,
		type ProjectKey,
		type ProjectView
	} from '$lib/projects';
	import AppSwitcher from '$lib/components/AppSwitcher.svelte';
	import PageFooter from '$lib/components/PageFooter.svelte';

	// Two views of the same tasks: status columns, or, on the All board, the
	// same columns split into one row per project. Drag a card to change its
	// status (and its project, in the lanes). Done only shows the last week
	// unless expanded. ?project=<folder> narrows the board to one project,
	// whose Inbox is its backlog; an empty ?project= is Quotidian (tasks in no
	// project). With no ?project= it is the All view of selectTasks.
	type View = 'columns' | 'lanes';
	const VIEW_KEY = 'scrinium:boardView';
	let view = $state<View>('columns');
	let showAllDone = $state(false);

	let draft = $state('');
	let addingTo = $state<string | null>(null);

	let dragId = $state<string | null>(null);
	let overCell = $state<string | null>(null);
	let overId = $state<string | null>(null);

	const WEEK = 7 * 86400000;
	// The lanes leave Inbox out: unplanned work has no row to sit in yet.
	const LANE_STATUSES = STATUSES.filter((s) => s.key !== 'inbox');

	const project = $derived(page.url.searchParams.get('project'));
	const proj = $derived($projects.find((p) => p.path === project) ?? null);
	const boardView = $derived<ProjectView>(project === null ? 'all' : { project: project || null });
	const lanesOn = $derived(view === 'lanes' && boardView === 'all');

	// A project that isn't in the list gets a fresh load before giving up:
	// one that no longer exists (removed or renamed, maybe in another tab)
	// falls back to the main board.
	$effect(() => {
		if (!project || proj) return;
		const want = project;
		void loadProjects().then((rows) => {
			if (rows && !rows.some((p) => p.path === want) && page.url.searchParams.get('project') === want)
				void goto('/tasks/kanban', { replaceState: true });
		});
	});

	onMount(() => {
		void loadTasks();
		if (localStorage.getItem(VIEW_KEY) === 'lanes') view = 'lanes';
		return usePageCommands([
			{ label: 'Board: status columns', hint: 'One column per status', run: () => setView('columns') },
			{ label: 'Board: project lanes', hint: 'Columns split by project', run: () => lanes_() },
			{ label: 'Board: toggle older done tasks', hint: 'Done shows the last week by default', run: () => (showAllDone = !showAllDone) },
			{ label: 'Board: all tasks', hint: 'Every project on one board', run: () => openBoard('all') },
			{ label: 'Board: Quotidian', hint: 'Tasks in no project', run: () => openBoard({ project: null }) }
		]);
	});

	function setView(v: View) {
		view = v;
		localStorage.setItem(VIEW_KEY, v);
	}

	const pool = $derived(topLevel(selectTasks($tasks, boardView)));

	// Lanes split the All board, so asking for them from a project board goes there.
	function lanes_() {
		setView('lanes');
		if (boardView !== 'all') openBoard('all');
	}

	function openBoard(v: ProjectView) {
		void goto(boardHref(v));
	}

	async function dropProject(path: string) {
		if (!confirm(`Remove project "${path}"? Its folder and notes stay, its tasks move to Quotidian.`)) return;
		if (await removeProject(path)) openBoard('all');
	}

	function cellRows(status: TaskStatus, lane?: ProjectKey): Task[] {
		let rows = pool.filter((t) => t.status === status && (lane === undefined || t.project === lane));
		if (status === 'done') {
			rows = rows.sort((a, b) => b.updated_at - a.updated_at);
			if (!showAllDone) rows = rows.filter((t) => t.updated_at >= Date.now() - WEEK);
			return rows;
		}
		return rows.sort((a, b) => a.position - b.position);
	}

	const doneTotal = $derived(pool.filter((t) => t.status === 'done').length);
	// Open tasks on each tab's board, Inbox backlog included.
	const openOn = (v: ProjectView) => topLevel(selectTasks($tasks, v)).filter((t) => t.status !== 'done').length;
	const styleOf = (key: ProjectKey) => projectStyle(key, $projects.find((p) => p.path === key));
	const openCount = $derived(pool.filter((t) => t.status !== 'done').length);
	const overdueCount = $derived(pool.filter(isOverdue).length);
	const todayCount = $derived(pool.filter((t) => t.status !== 'done' && isDueToday(t)).length);
	const inboxCount = $derived(pool.filter((t) => t.status === 'inbox').length);
	const lanes = $derived<ProjectKey[]>([null, ...$projects.map((p) => p.path)]);
	const doingCount = $derived(pool.filter((t) => t.status === 'doing').length);
	// The summary line's ring counts every card on this board, done ones of any age.
	const doneShare = $derived(pool.length ? doneTotal / pool.length : 0);
	const nextDue = $derived(
		pool
			.filter((t) => t.status !== 'done' && t.due_at != null && !isOverdue(t))
			.sort((a, b) => (a.due_at ?? 0) - (b.due_at ?? 0))[0] ?? null
	);

	function weekRange(): string {
		const now = new Date();
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
		const sunday = new Date(monday.getTime() + 6 * 86400000);
		const f = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
		return `${f(monday)} to ${f(sunday)}`;
	}


	// Clicking a card opens the detail drawer; drags and controls are exempt.
	function cardClick(t: Task, e: MouseEvent) {
		if (dragId) return;
		if ((e.target as HTMLElement).closest('input,button,a')) return;
		openTask(t.id);
	}

	async function add(status: TaskStatus, lane?: ProjectKey) {
		const title = draft.trim();
		if (!title) return;
		draft = '';
		const row = await createTask({ title, status, project: lane === undefined ? project || null : lane });
		if (!row && !draft) draft = title;
	}

	function startAdd(cell: string) {
		draft = '';
		addingTo = cell;
	}

	function cellKey(status: TaskStatus, lane?: ProjectKey) {
		return lane === undefined ? status : `${status}|${lane ?? ''}`;
	}

	function onDragStart(t: Task, e: DragEvent) {
		dragId = t.id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', t.id);
		}
	}

	function onDragEnd() {
		dragId = null;
		overCell = null;
		overId = null;
	}

	function onCellOver(key: string, e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		if (overCell !== key) {
			overCell = key;
			overId = null;
		}
	}

	function onCardOver(key: string, id: string, e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		overCell = key;
		overId = id;
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}

	// Position between neighbours so a drop rarely renumbers the column.
	// Positions start near Date.now(), where doubles only resolve ~1e-4, so
	// repeated drops into one gap run out of room: then the midpoint equals
	// a neighbour and the cell is renumbered (renumber below).
	function positionAt(rows: Task[], targetId: string | null): number {
		let idx = rows.length;
		if (targetId) {
			const at = rows.findIndex((t) => t.id === targetId);
			if (at !== -1) idx = at;
		}
		const prev = rows[idx - 1]?.position;
		const next = rows[idx]?.position;
		if (prev != null && next != null) {
			const mid = (prev + next) / 2;
			return mid === prev || mid === next ? NaN : mid;
		}
		if (prev != null) return prev + 1000;
		if (next != null) return next - 1000;
		return Date.now();
	}

	// Rewrite a cell's positions as even steps, `moving` placed before
	// `targetId` (or last). Only for the rare exhausted gap.
	async function renumber(rows: Task[], moving: Task, targetId: string | null, patch: TaskPatch) {
		const order = [...rows];
		const at = targetId ? order.findIndex((t) => t.id === targetId) : -1;
		order.splice(at === -1 ? order.length : at, 0, moving);
		const base = Date.now();
		for (const [i, t] of order.entries()) {
			const position = base + i * 1000;
			if (t.id === moving.id) await updateTask(t.id, { ...patch, position });
			else if (t.position !== position) await updateTask(t.id, { position });
		}
	}

	async function onDrop(status: TaskStatus, lane: ProjectKey | undefined, e: DragEvent) {
		e.preventDefault();
		const id = dragId ?? e.dataTransfer?.getData('text/plain');
		const targetId = overId;
		onDragEnd();
		if (!id) return;
		const moving = $tasks.find((t) => t.id === id);
		if (!moving) return;
		const sameCell = moving.status === status && (lane === undefined || moving.project === lane);
		// Dropped back onto itself: nothing moves.
		if (targetId === id && sameCell) return;
		const rows = cellRows(status, lane).filter((t) => t.id !== id);
		const patch: TaskPatch = { status };
		if (lane !== undefined && lane !== moving.project) patch.project = lane;
		const position = positionAt(rows, targetId === id ? null : targetId);
		if (Number.isNaN(position)) await renumber(rows, moving, targetId, patch);
		else await updateTask(id, { ...patch, position });
	}

	// Keyboard and button fallbacks for drag and drop.
	async function shiftColumn(t: Task, dir: 1 | -1) {
		const order = STATUSES.map((s) => s.key);
		const next = order[order.indexOf(t.status) + dir];
		if (next) await updateTask(t.id, { status: next, position: Date.now() });
	}

	// Swap with the neighbour in the same cell (the lane, in By project).
	// Done is ordered by completion time, so there is nothing to reorder there.
	async function shiftOrder(t: Task, dir: 1 | -1, lane: ProjectKey | undefined) {
		if (t.status === 'done') return;
		const rows = cellRows(t.status, lane);
		const i = rows.findIndex((x) => x.id === t.id);
		const other = rows[i + dir];
		if (!other) return;
		if (other.position === t.position) {
			const rest = rows.filter((x) => x.id !== t.id);
			const before = dir === 1 ? rest[i + 1]?.id ?? null : other.id;
			await renumber(rest, t, before, {});
			return;
		}
		await updateTask(t.id, { position: other.position });
		await updateTask(other.id, { position: t.position });
	}

	// The lane a card's cell key names: undefined in Columns view. Status
	// keys hold no '|', so the first one ends the status.
	function laneOf(key: string): ProjectKey | undefined {
		const at = key.indexOf('|');
		return at === -1 ? undefined : key.slice(at + 1) || null;
	}


	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

{#snippet card(t: Task, key: string, showProject: boolean)}
	{@const waited = t.status === 'waiting' && t.waiting_since != null ? daysSince(t.waiting_since) : null}
	{@const idle = t.status === 'doing' ? daysSince(t.updated_at) : 0}
	{@const subs = $subtaskCounts.get(t.id)}
	{@const due = t.due_at != null && t.status !== 'done'}
	<div
		class="kc"
		class:done={t.status === 'done'}
		class:dragging={dragId === t.id}
		class:on={$openTaskId === t.id}
		draggable="true"
		ondragstart={(e) => onDragStart(t, e)}
		ondragend={onDragEnd}
		ondragover={(e) => onCardOver(key, t.id, e)}
		onclick={(e) => cardClick(t, e)}
		role="button"
		tabindex="0"
		aria-label="Open {t.title} details"
		data-task={t.id}
		data-nav={t.status}
		data-nav-row={laneOf(key) ?? ''}
		onkeydown={(e) => {
			if (e.target !== e.currentTarget) return;
			if (e.key === 'Enter') openTask(t.id);
			else if (e.altKey && e.key.startsWith('Arrow')) {
				e.preventDefault();
				const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
				const move =
					e.key === 'ArrowLeft' || e.key === 'ArrowRight'
						? shiftColumn(t, dir)
						: shiftOrder(t, dir, laneOf(key));
				// Once for the optimistic paint, again when a renumber settles.
				void refocusTask(t.id);
				void move.then(() => refocusTask(t.id));
			}
		}}
	>
		{#if overId === t.id && dragId && dragId !== t.id}<div class="ins"></div>{/if}
		{#if t.status === 'done'}<span class="material-symbols-outlined chk">check_circle</span>{/if}
		<div class="kt">{t.title}</div>
		{#if (showProject && t.project) || t.priority !== 'none' || due || (t.status === 'waiting' && (t.waiting_on || waited != null)) || idle >= STALE_DAYS || subs || t.remind_at != null || t.link_count > 0}
			<div class="km">
				{#if showProject && t.project}
					{@const ps = styleOf(t.project)}
					<span class="proj" style:color={colorVar(ps.color)} title={t.project}>
						<span class="material-symbols-outlined">{ps.icon}</span>{projectName(t.project)}
					</span>
				{/if}
				{#if t.priority !== 'none'}
					<span class="pri-{t.priority}">
						<span class="material-symbols-outlined fill">flag</span>{t.priority}
					</span>
				{/if}
				{#if due}
					<span class:over={isOverdue(t)} class:today={isDueToday(t)}>
						<span class="material-symbols-outlined">{isOverdue(t) ? 'event_busy' : isDueToday(t) ? 'today' : 'event'}</span>
						{isDueToday(t) ? 'Today' : dueLabel(t.due_at)}
					</span>
				{/if}
				{#if t.status === 'waiting' && (t.waiting_on || waited != null)}
					<span class:warn={waited != null && waited >= LONG_WAIT_DAYS} title="Waiting on">
						<span class="material-symbols-outlined">person</span>
						{t.waiting_on ?? 'Someone'}{waited != null ? `, ${plural(waited, 'day')}` : ''}
					</span>
				{/if}
				{#if idle >= STALE_DAYS}
					<span class="warn" title="Untouched for {plural(idle, 'day')}">
						<span class="material-symbols-outlined">schedule</span>{plural(idle, 'day')}
					</span>
				{/if}
				{#if subs}
					<span title="Subtasks"><span class="material-symbols-outlined">subdirectory_arrow_right</span>{subs}</span>
				{/if}
				{#if t.remind_at != null}
					<span title="Reminds {stampShort(t.remind_at)}"><span class="material-symbols-outlined">notifications</span></span>
				{/if}
				{#if t.link_count > 0}
					<span class="r" title="Linked notes"><span class="material-symbols-outlined">description</span>{t.link_count}</span>
				{/if}
			</div>
		{/if}
		<span class="ops">
			<button title="Move left (Alt+Left)" onclick={() => void shiftColumn(t, -1)}>
				<span class="material-symbols-outlined">chevron_left</span>
			</button>
			<button title="Move right (Alt+Right)" onclick={() => void shiftColumn(t, 1)}>
				<span class="material-symbols-outlined">chevron_right</span>
			</button>
			<button
				title="Delete"
				onclick={() => void deleteTask(t.id)}
			>
				<span class="material-symbols-outlined">delete</span>
			</button>
		</span>
	</div>
{/snippet}

{#snippet adder(status: TaskStatus, lane?: ProjectKey)}
	{@const key = cellKey(status, lane)}
	{#if addingTo === key}
		<input
			class="add-in"
			placeholder="Task name, Enter to add"
			bind:value={draft}
			{@attach (el) => el.focus()}
			onblur={() => (addingTo = null)}
			onkeydown={(e) => {
				if (e.key === 'Enter') void add(status, lane);
				if (e.key === 'Escape') addingTo = null;
			}}
		/>
	{:else}
		<button class="col-add" onclick={() => startAdd(key)}>
			<span class="material-symbols-outlined">add</span>Add task
		</button>
	{/if}
{/snippet}

<div class="page" {@attach keyNav}>
	<header class="page-h">
		<AppSwitcher current="board" size="lg" />
		<span class="sp"></span>
		{#if boardView === 'all'}
			<div class="seg" role="group" aria-label="Board view">
				<button class:on={!lanesOn} onclick={() => setView('columns')}>
					<span class="material-symbols-outlined">view_week</span>Columns
				</button>
				<button class:on={lanesOn} onclick={() => setView('lanes')}>
					<span class="material-symbols-outlined">table_rows</span>By project
				</button>
			</div>
		{/if}
		<button
			class="btn primary"
			onclick={() => {
				view = 'columns';
				startAdd(cellKey('inbox'));
			}}
		>
			<span class="material-symbols-outlined">add</span>New task
		</button>
	</header>
	<div class="pane body">
	<nav class="tabs" aria-label="Project">
		<button class="chip" class:on={boardView === 'all'} onclick={() => openBoard('all')}>
			<span class="material-symbols-outlined">apps</span>All<span class="n">{openOn('all')}</span>
		</button>
		{#each lanes as key (key ?? '')}
			{@const ps = styleOf(key)}
			<button
				class="chip"
				class:on={boardView !== 'all' && boardView.project === key}
				style:--c={colorVar(ps.color)}
				onclick={() => openBoard({ project: key })}
			>
				<span class="material-symbols-outlined fill">{ps.icon}</span>
				{projectLabel(key)}<span class="n">{openOn({ project: key })}</span>
			</button>
		{/each}
		<button class="icon" title="New project" onclick={() => newProjectOpen.set(true)}>
			<span class="material-symbols-outlined">add</span>
		</button>
	</nav>
	<div class="sum">
		{#if boardView === 'all'}
			<span class="material-symbols-outlined sum-i">apps</span>
		{:else}
			{@const ps = styleOf(boardView.project)}
			<span class="ring" style:--c={colorVar(ps.color)} title="{doneTotal} of {pool.length} done">
				<svg viewBox="0 0 30 30" aria-hidden="true">
					<circle class="track" cx="15" cy="15" r="12" />
					{#if doneTotal > 0}
						<circle class="arc" cx="15" cy="15" r="12" pathLength="100" stroke-dasharray="{doneShare * 100} 100" />
					{/if}
				</svg>
				<span class="material-symbols-outlined fill">{ps.icon}</span>
			</span>
		{/if}
		<strong>{boardView === 'all' ? 'All projects' : projectLabel(boardView.project)}</strong>
		<span class="facts">
			<span>{openCount} open</span>
			{#if boardView !== 'all'}<span>{doneTotal} of {pool.length} done</span>{/if}
			<span class:warn={doingCount > DOING_LIMIT}>{doingCount} in progress</span>
			{#if overdueCount > 0}<span class="over">{overdueCount} overdue</span>{/if}
			{#if todayCount > 0}<span class="today">{todayCount} due today</span>{/if}
			{#if nextDue}<span>Next: {nextDue.title}, {dueLabel(nextDue.due_at)}</span>{/if}
		</span>
		<span class="sp"></span>
		{#if proj}
			<button class="btn" title="Remove project" onclick={() => void dropProject(proj.path)}>
				<span class="material-symbols-outlined">folder_off</span>Remove project
			</button>
		{/if}
	</div>

	{#if !lanesOn}
		<div class="board">
			{#each STATUSES as col (col.key)}
				{@const rows = cellRows(col.key)}
				{@const key = cellKey(col.key)}
				<section
					class="col"
					class:drop={overCell === key && dragId}
					ondragover={(e) => onCellOver(key, e)}
					ondrop={(e) => void onDrop(col.key, undefined, e)}
					aria-label={col.label}
				>
					<div class="col-h {col.key}">
						<span class="material-symbols-outlined ci {col.key}">{col.icon}</span>
						{col.label}
						{#if col.key === 'doing'}
							<span class="n">{rows.length}</span>
							<span class="aside" class:warn={rows.length > DOING_LIMIT}>
								{rows.length > DOING_LIMIT ? `${rows.length - DOING_LIMIT} over limit` : `limit ${DOING_LIMIT}`}
							</span>
						{:else}
							<span class="n">{rows.length}</span>
							{#if col.key === 'todo'}
								<span class="aside">{weekRange()}</span>
							{:else if col.key === 'inbox' && proj}
								<span class="aside" title="Only on this board">Backlog</span>
							{:else if col.key === 'done'}
								<button class="aside link" title="Toggle older done tasks" onclick={() => (showAllDone = !showAllDone)}>
									{showAllDone ? 'All time' : 'Last 7 days'}
								</button>
							{/if}
						{/if}
					</div>
					<div class="cards">
						{#each rows as t (t.id)}
							{@render card(t, key, boardView === 'all')}
						{/each}
						{#if overCell === key && dragId && !overId}<div class="ins end"></div>{/if}
						{#if col.key !== 'done'}
							{@render adder(col.key)}
						{:else if !showAllDone && doneTotal > rows.length}
							<button class="col-add" onclick={() => (showAllDone = true)}>
								<span class="material-symbols-outlined">history</span>Show {doneTotal - rows.length} older
							</button>
						{/if}
					</div>
				</section>
			{/each}
		</div>
	{:else}
		<div class="lanes">
			<div class="grid" style="grid-template-columns: 160px repeat({LANE_STATUSES.length}, minmax(220px, 1fr))">
				<div class="lh corner"></div>
				{#each LANE_STATUSES as st (st.key)}
					<div class="lh">
						<span class="material-symbols-outlined ci {st.key}">{st.icon}</span>{st.label}
						<span class="n">{cellRows(st.key).length}</span>
					</div>
				{/each}
				{#each lanes as lane (lane ?? '')}
					<div class="ln">
						<span class="ln-name"
							><span class="material-symbols-outlined" style:color={colorVar(styleOf(lane).color)}
								>{styleOf(lane).icon}</span
							>{projectLabel(lane)}</span
						>
						<small>{pool.filter((t) => t.project === lane && t.status !== 'done' && t.status !== 'inbox').length} open</small>
					</div>
					{#each LANE_STATUSES as st (st.key)}
						{@const key = cellKey(st.key, lane)}
						<div
							class="cell"
							class:drop={overCell === key && dragId}
							ondragover={(e) => onCellOver(key, e)}
							ondrop={(e) => void onDrop(st.key, lane, e)}
							role="list"
							aria-label="{projectLabel(lane)}, {st.label}"
						>
							{#each cellRows(st.key, lane) as t (t.id)}
								{@render card(t, key, false)}
							{/each}
							{#if overCell === key && dragId && !overId}<div class="ins end"></div>{/if}
							{#if st.key !== 'done'}
								{@render adder(st.key, lane)}
							{/if}
						</div>
					{/each}
				{/each}
			</div>
			{#if inboxCount > 0}
				<div class="note-row">
					<span class="material-symbols-outlined">inbox</span>
					Inbox has {inboxCount} unplanned {inboxCount === 1 ? 'task' : 'tasks'}.
					<button class="link" onclick={() => setView('columns')}>Sort them in Columns</button>
				</div>
			{/if}
		</div>
	{/if}

	</div>

	<PageFooter actions />
</div>

<style>
	.page {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.page-h {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 52px;
		padding: 0 6px 0 14px;
		flex-shrink: 0;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.tabs {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 12px 16px 0;
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.chip {
		--c: var(--text-2);
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 30px;
		padding: 0 11px 0 9px;
		border: none;
		border-radius: 9px;
		background: none;
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--text-2);
		font: 500 var(--t-meta) var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
	}
	.chip:hover {
		background: var(--hover);
		color: var(--text);
	}
	.chip .material-symbols-outlined {
		font-size: 16px;
		color: var(--c);
	}
	.chip .n {
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.chip.on {
		background: color-mix(in srgb, var(--c) 14%, var(--raise));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 40%, transparent);
		color: var(--text);
	}
	.chip.on .n {
		color: var(--text-2);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--hover);
		color: var(--text);
	}
	.icon .material-symbols-outlined {
		font-size: 18px;
	}
	.sum {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 52px;
		margin: 12px 16px 4px;
		padding: 0 6px 0 10px;
		border-radius: var(--r-xl);
		background: var(--raise);
		box-shadow: inset 0 0 0 1px var(--rim);
		flex-shrink: 0;
		overflow: hidden;
	}
	.sum strong {
		font: 600 var(--t-label) var(--font-ui);
		white-space: nowrap;
	}
	.sum-i {
		width: 30px;
		text-align: center;
		color: var(--text-3);
	}
	.facts {
		display: flex;
		gap: 0;
		min-width: 0;
		overflow: hidden;
		color: var(--text-3);
		font-size: var(--t-meta);
		white-space: nowrap;
	}
	.facts > span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.facts > span + span::before {
		content: '·';
		margin: 0 8px;
		color: var(--text-4);
	}
	.facts .over {
		color: var(--red);
	}
	.facts .today {
		color: var(--accent);
	}
	.facts .warn {
		color: var(--orange);
	}
	.ring {
		position: relative;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
	}
	.ring svg {
		position: absolute;
		inset: 0;
		transform: rotate(-90deg);
	}
	.ring circle {
		fill: none;
		stroke-width: 2.5;
	}
	.ring .track {
		stroke: color-mix(in srgb, var(--c) 22%, transparent);
	}
	.ring .arc {
		stroke: var(--c);
		stroke-linecap: round;
	}
	.ring .material-symbols-outlined {
		font-size: 15px;
		color: var(--c);
	}
	.sp {
		flex: 1;
	}
	.board {
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: grid;
		grid-template-columns: repeat(5, minmax(220px, 1fr));
		gap: 10px;
		padding: 8px 16px 16px;
		align-items: start;
	}
	.col {
		display: flex;
		flex-direction: column;
		max-height: 100%;
		min-height: 120px;
		padding: 4px;
		border-radius: var(--r-xl);
		background: var(--raise);
		box-shadow: inset 0 0 0 1px var(--rim);
	}
	.col.drop {
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.col-h {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 8px;
		font: 600 var(--t-meta) var(--font-ui);
		white-space: nowrap;
		overflow: hidden;
		flex-shrink: 0;
	}
	.aside {
		margin-left: auto;
		color: var(--text-3);
		font-size: var(--fs-xs);
		font-weight: 400;
		white-space: nowrap;
	}
	.aside.warn {
		color: var(--orange);
	}
	.ci {
		font-size: 18px;
		color: var(--text-3);
	}
	.ci.doing {
		color: var(--accent);
	}
	.ci.waiting {
		color: var(--yellow);
	}
	.ci.done {
		color: var(--green);
	}
	.n {
		color: var(--text-3);
		font-weight: 400;
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		color: var(--text-3);
		font: var(--fs-xs) var(--font-ui);
		cursor: pointer;
	}
	.link:hover {
		color: var(--accent);
	}
	.cards {
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow-y: auto;
		min-height: 0;
		border-radius: 9px;
		background: var(--inset);
		box-shadow: inset 0 0 0 1px var(--rim);
	}
	.kc {
		position: relative;
		background: #2a2a2a;
		border-radius: var(--r-md);
		box-shadow: inset 0 0 0 1px var(--rim), 0 1px 2px rgba(0, 0, 0, 0.4);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		cursor: grab;
	}
	.kc:hover {
		background: #2f2f2f;
	}
	.kc.on {
		box-shadow: inset 0 0 0 1px var(--accent), 0 1px 2px rgba(0, 0, 0, 0.4);
	}
	.kc.dragging {
		opacity: 0.4;
	}
	.kc.done {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		column-gap: 8px;
		padding: 8px 12px;
		background: none;
		box-shadow: none;
	}
	.kc.done .km {
		grid-column: 2;
	}
	.chk {
		font-size: 16px;
		color: var(--text-4);
	}
	.kc.done .kt {
		color: var(--text-3);
		font-size: var(--fs);
	}
	.kt {
		color: var(--text);
		font-size: var(--fs-md);
		line-height: 1.4;
		padding-right: 18px;
	}
	.km {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 12px;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.km span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.km .material-symbols-outlined {
		font-size: 15px;
	}
	.km .over {
		color: var(--red);
	}
	.km .today {
		color: var(--accent);
	}
	.km .warn {
		color: var(--orange);
	}
	.km .r {
		margin-left: auto;
	}
	.pri-urgent {
		color: var(--red);
	}
	.pri-high {
		color: var(--orange);
	}
	.pri-medium {
		color: var(--yellow);
	}
	.pri-low {
		color: var(--blue);
	}
	.ops {
		position: absolute;
		top: 6px;
		right: 6px;
		display: none;
		gap: 1px;
		background: #2f2f2f;
		border-radius: var(--r);
	}
	.kc:hover .ops,
	.kc:focus-within .ops {
		display: inline-flex;
	}
	.ops button {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.ops button:hover {
		background: var(--press);
		color: var(--text);
	}
	.ops .material-symbols-outlined {
		font-size: 16px;
	}
	.ins {
		position: absolute;
		left: 2px;
		right: 2px;
		top: -6px;
		height: 2px;
		border-radius: 2px;
		background: var(--accent);
	}
	.ins.end {
		position: static;
		margin: -4px 2px 0;
	}
	.col-add {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 6px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		font: var(--fs) var(--font-ui);
		cursor: pointer;
	}
	.col-add:hover {
		background: var(--hover);
		color: var(--text);
	}
	.add-in {
		height: 36px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-md);
		box-shadow: inset 0 0 0 1px var(--accent);
		background: #2a2a2a;
		color: var(--text);
		font: var(--fs-md) var(--font-ui);
		outline: none;
	}
	.lanes {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0 16px 16px;
	}
	.grid {
		display: grid;
	}
	.lh {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 44px;
		padding: 0 10px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		font-weight: 600;
	}
	.ln {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 14px 10px;
		border-bottom: 1px solid var(--line);
	}
	.ln-name {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
	}
	.ln-name .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.ln small {
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 64px;
		padding: 10px 5px;
		border-bottom: 1px solid var(--line);
		border-left: 1px solid var(--line);
	}
	.cell.drop {
		background: var(--accent-dim);
	}
	.cell .kc {
		padding: 9px 10px;
	}
	/* Lane cells keep their add button out of the way until hovered. */
	.cell .col-add {
		height: 28px;
		opacity: 0;
	}
	.cell:hover .col-add,
	.cell .col-add:focus-visible {
		opacity: 1;
	}
	.note-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
		padding: 10px 12px;
		border: 1px dashed var(--line-2);
		border-radius: var(--r-md);
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.note-row .material-symbols-outlined {
		font-size: 17px;
	}
	.note-row .link {
		font-size: var(--fs-sm);
		color: var(--accent);
	}
</style>
