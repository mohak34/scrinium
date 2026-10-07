<script lang="ts">
	import { onMount } from 'svelte';
	import {
		tasks,
		loadTasks,
		createTask,
		updateTask,
		deleteTask,
		openTask,
		openTaskId,
		topLevel,
		childrenOf,
		isOverdue,
		isDueToday,
		dueLabel,
		stampShort,
		STATUSES,
		AREAS,
		type Task,
		type TaskArea,
		type TaskStatus,
		type TaskUpdate as TaskPatch
	} from '$lib/stores/tasks';
	import { areaMeta, DOING_LIMIT } from '$lib/taskModel';
	import AppSwitcher from '$lib/components/AppSwitcher.svelte';
	import PageFooter from '$lib/components/PageFooter.svelte';

	// Two views of the same tasks: status columns, or the same columns split
	// into one row per area. Drag a card to change its status (and its area,
	// in the area view). Done only shows the last week unless expanded.
	type View = 'columns' | 'areas';
	const VIEW_KEY = 'scrinium:boardView';
	let view = $state<View>('columns');
	let area = $state<TaskArea | null>(null);
	let showAllDone = $state(false);

	let draft = $state('');
	let addingTo = $state<string | null>(null);

	let dragId = $state<string | null>(null);
	let overCell = $state<string | null>(null);
	let overId = $state<string | null>(null);

	const WEEK = 7 * 86400000;
	// The area view leaves Inbox out: unplanned work has no row to sit in yet.
	const LANE_STATUSES = STATUSES.filter((s) => s.key !== 'inbox');

	onMount(() => {
		void loadTasks();
		if (localStorage.getItem(VIEW_KEY) === 'areas') view = 'areas';
	});

	function setView(v: View) {
		view = v;
		localStorage.setItem(VIEW_KEY, v);
	}

	const pool = $derived(topLevel($tasks).filter((t) => area == null || t.area === area));

	function cellRows(status: TaskStatus, laneArea?: TaskArea | null): Task[] {
		let rows = pool.filter(
			(t) => t.status === status && (laneArea === undefined || (t.area ?? null) === laneArea)
		);
		if (status === 'done') {
			rows = rows.sort((a, b) => b.updated_at - a.updated_at);
			if (!showAllDone) rows = rows.filter((t) => t.updated_at >= Date.now() - WEEK);
			return rows;
		}
		return rows.sort((a, b) => a.position - b.position);
	}

	const doneTotal = $derived(pool.filter((t) => t.status === 'done').length);
	const openCount = $derived(pool.filter((t) => t.status !== 'done').length);
	const overdueCount = $derived(pool.filter(isOverdue).length);
	const todayCount = $derived(pool.filter((t) => t.status !== 'done' && isDueToday(t)).length);
	const inboxCount = $derived(pool.filter((t) => t.status === 'inbox').length);
	const lanes = $derived([
		...AREAS.map((a) => ({ key: a.key as TaskArea | null, label: a.label, color: a.color })),
		...(pool.some((t) => t.area == null && t.status !== 'inbox')
			? [{ key: null, label: 'No area', color: 'var(--text-4)' }]
			: [])
	]);

	function weekRange(): string {
		const now = new Date();
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
		const sunday = new Date(monday.getTime() + 6 * 86400000);
		const f = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
		return `${f(monday)} to ${f(sunday)}`;
	}

	function subLabel(key: TaskStatus): string {
		if (key === 'todo') return `Committed for ${weekRange()}`;
		if (key === 'done') return showAllDone ? 'All time' : 'Last 7 days';
		return STATUSES.find((s) => s.key === key)!.hint;
	}

	// Clicking a card opens the detail drawer; drags and controls are exempt.
	function cardClick(t: Task, e: MouseEvent) {
		if (dragId) return;
		if ((e.target as HTMLElement).closest('input,button,a')) return;
		openTask(t.id);
	}

	async function add(status: TaskStatus, laneArea?: TaskArea | null) {
		const title = draft.trim();
		if (!title) return;
		draft = '';
		await createTask({ title, status, area: laneArea === undefined ? area : laneArea });
	}

	function startAdd(cell: string) {
		draft = '';
		addingTo = cell;
	}

	function cellKey(status: TaskStatus, laneArea?: TaskArea | null) {
		return laneArea === undefined ? status : `${status}|${laneArea ?? ''}`;
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

	async function onDrop(status: TaskStatus, laneArea: TaskArea | null | undefined, e: DragEvent) {
		e.preventDefault();
		const id = dragId ?? e.dataTransfer?.getData('text/plain');
		const targetId = overId;
		onDragEnd();
		if (!id) return;
		const moving = $tasks.find((t) => t.id === id);
		if (!moving) return;
		const sameCell = moving.status === status && (laneArea === undefined || (moving.area ?? null) === laneArea);
		// Dropped back onto itself: nothing moves.
		if (targetId === id && sameCell) return;
		const rows = cellRows(status, laneArea).filter((t) => t.id !== id);
		const patch: TaskPatch = { status };
		if (laneArea !== undefined) patch.area = laneArea;
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

	// Swap with the neighbour in the same cell (the lane, in By area). Done
	// is ordered by completion time, so there is nothing to reorder there.
	async function shiftOrder(t: Task, dir: 1 | -1, laneArea: TaskArea | null | undefined) {
		if (t.status === 'done') return;
		const rows = cellRows(t.status, laneArea);
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

	// The lane a card's cell key names: undefined in Columns view.
	function laneOf(key: string): TaskArea | null | undefined {
		if (!key.includes('|')) return undefined;
		return (key.split('|')[1] || null) as TaskArea | null;
	}

	function subCount(t: Task): string | null {
		const kids = childrenOf($tasks, t.id);
		if (kids.length === 0) return null;
		return `${kids.filter((k) => k.status === 'done').length}/${kids.length}`;
	}

	function since(ts: number | null): string {
		if (ts == null) return '';
		return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
	}
</script>

{#snippet card(t: Task, key: string, showArea: boolean)}
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
		onkeydown={(e) => {
			if (e.target !== e.currentTarget) return;
			if (e.key === 'Enter') openTask(t.id);
			else if (e.altKey && e.key === 'ArrowLeft') void shiftColumn(t, -1);
			else if (e.altKey && e.key === 'ArrowRight') void shiftColumn(t, 1);
			else if (e.altKey && e.key === 'ArrowUp') void shiftOrder(t, -1, laneOf(key));
			else if (e.altKey && e.key === 'ArrowDown') void shiftOrder(t, 1, laneOf(key));
		}}
	>
		{#if overId === t.id && dragId && dragId !== t.id}<div class="ins"></div>{/if}
		{#if showArea && t.area}
			<span class="area"><i style="background: {areaMeta(t.area).color}"></i>{areaMeta(t.area).label}</span>
		{/if}
		<div class="kt">{t.title}</div>
		{#if t.status === 'waiting' && (t.waiting_on || t.waiting_since)}
			<div class="wait">
				<span class="material-symbols-outlined">person</span>
				{t.waiting_on ?? 'Someone'}{t.waiting_since ? `, since ${since(t.waiting_since)}` : ''}
			</div>
		{/if}
		{#if t.due_at != null || t.priority !== 'none' || subCount(t) || t.link_count > 0 || t.remind_at != null}
			<div class="km">
				{#if t.due_at != null}
					<span class:over={isOverdue(t)} class:today={isDueToday(t) && t.status !== 'done'}>
						<span class="material-symbols-outlined">{t.status === 'done' ? 'check' : 'event'}</span>
						{isDueToday(t) && t.status !== 'done' ? 'Today' : dueLabel(t.due_at)}
					</span>
				{/if}
				{#if t.priority !== 'none'}
					<span class="pri-{t.priority}">
						<span class="material-symbols-outlined fill">flag</span>{t.priority}
					</span>
				{/if}
				{#if subCount(t)}
					<span title="Subtasks"><span class="material-symbols-outlined">subdirectory_arrow_right</span>{subCount(t)}</span>
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
				onclick={() => {
					if (confirm(`Delete "${t.title}"?`)) void deleteTask(t.id);
				}}
			>
				<span class="material-symbols-outlined">delete</span>
			</button>
		</span>
	</div>
{/snippet}

{#snippet adder(status: TaskStatus, laneArea?: TaskArea | null)}
	{@const key = cellKey(status, laneArea)}
	{#if addingTo === key}
		<input
			class="add-in"
			placeholder="Task name, Enter to add"
			bind:value={draft}
			{@attach (el) => el.focus()}
			onblur={() => (addingTo = null)}
			onkeydown={(e) => {
				if (e.key === 'Enter') void add(status, laneArea);
				if (e.key === 'Escape') addingTo = null;
			}}
		/>
	{:else}
		<button class="col-add" onclick={() => startAdd(key)}>
			<span class="material-symbols-outlined">add</span>{status === 'inbox' ? 'Capture' : 'Add task'}
		</button>
	{/if}
{/snippet}

<div class="page">
	<header class="page-h">
		<AppSwitcher current="board" size="lg" />
		<span class="cnt">{openCount} open</span>
		<span class="vsep"></span>
		<div class="areas" role="group" aria-label="Filter by area">
			<button class:on={area === null} onclick={() => (area = null)}>All</button>
			{#each AREAS as a (a.key)}
				<button class:on={area === a.key} onclick={() => (area = area === a.key ? null : a.key)}>
					<i style="background: {a.color}"></i>{a.label}
				</button>
			{/each}
		</div>
		<span class="sp"></span>
		<div class="seg" role="group" aria-label="Board view">
			<button class:on={view === 'columns'} onclick={() => setView('columns')}>
				<span class="material-symbols-outlined">view_week</span>Columns
			</button>
			<button class:on={view === 'areas'} onclick={() => setView('areas')}>
				<span class="material-symbols-outlined">table_rows</span>By area
			</button>
		</div>
		<button
			class="solid"
			onclick={() => {
				view = 'columns';
				startAdd(cellKey('inbox'));
			}}
		>
			<span class="material-symbols-outlined">add</span>New task
		</button>
	</header>

	{#if view === 'columns'}
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
					<div class="col-h">
						<span class="material-symbols-outlined ci {col.key}">{col.icon}</span>
						{col.label}<span class="n">{col.key === 'done' ? doneTotal : rows.length}</span>
						<span class="sp"></span>
						{#if col.key === 'doing'}
							<span class="limit" class:over={rows.length > DOING_LIMIT}>limit {DOING_LIMIT}</span>
						{:else if col.key === 'done'}
							<button class="link" onclick={() => (showAllDone = !showAllDone)}>
								{showAllDone ? 'Last week' : 'Show all'}
							</button>
						{/if}
					</div>
					<div class="col-sub">{subLabel(col.key)}</div>
					<div class="cards">
						{#each rows as t (t.id)}
							{@render card(t, key, area === null)}
						{/each}
						{#if overCell === key && dragId && !overId}<div class="ins end"></div>{/if}
						{#if col.key !== 'done'}
							{@render adder(col.key)}
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
						<span class="n">{st.key === 'done' ? doneTotal : cellRows(st.key).length}</span>
					</div>
				{/each}
				{#each lanes as lane (lane.key ?? 'none')}
					<div class="ln">
						<span class="ln-name"><i style="background: {lane.color}"></i>{lane.label}</span>
						<small>{pool.filter((t) => (t.area ?? null) === lane.key && t.status !== 'done' && t.status !== 'inbox').length} open</small>
					</div>
					{#each LANE_STATUSES as st (st.key)}
						{@const key = cellKey(st.key, lane.key)}
						<div
							class="cell"
							class:drop={overCell === key && dragId}
							ondragover={(e) => onCellOver(key, e)}
							ondrop={(e) => void onDrop(st.key, lane.key, e)}
							role="list"
							aria-label="{lane.label}, {st.label}"
						>
							{#each cellRows(st.key, lane.key) as t (t.id)}
								{@render card(t, key, false)}
							{/each}
							{#if overCell === key && dragId && !overId}<div class="ins end"></div>{/if}
							{#if st.key !== 'done'}
								{@render adder(st.key, lane.key)}
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

	<PageFooter actions>
		<span>{openCount} open</span>
		{#if todayCount > 0}<span>{todayCount} due today</span>{/if}
		{#if overdueCount > 0}<span class="red">{overdueCount} overdue</span>{/if}
	</PageFooter>
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
		gap: 12px;
		height: 56px;
		padding: 0 16px 0 24px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}
	.cnt {
		color: var(--text-3);
		white-space: nowrap;
	}
	.sp {
		flex: 1;
	}
	.vsep {
		width: 1px;
		height: 18px;
		background: var(--line-2);
	}
	.areas {
		display: flex;
		gap: 2px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.areas button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 28px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text-3);
		font: var(--fs) var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
	}
	.areas button:hover {
		color: var(--text);
	}
	.areas button.on {
		background: var(--raise);
		color: var(--text);
	}
	.areas i,
	.area i,
	.ln-name i {
		width: 7px;
		height: 7px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-md);
	}
	.seg button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		font: var(--fs) var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
	}
	.seg button .material-symbols-outlined {
		font-size: 17px;
	}
	.seg button.on {
		background: var(--raise);
		color: var(--text);
	}
	.solid {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 14px 0 10px;
		border: none;
		border-radius: var(--r-md);
		background: var(--accent-fill);
		color: var(--on-accent);
		font: 600 var(--fs) var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
	}
	.solid:hover {
		background: var(--accent-fill-hi);
	}
	.board {
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: grid;
		grid-template-columns: repeat(5, minmax(240px, 1fr));
		gap: 10px;
		padding: 14px 16px 16px;
		align-items: start;
	}
	.col {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		display: flex;
		flex-direction: column;
		max-height: 100%;
		min-height: 120px;
	}
	.col.drop {
		border-color: color-mix(in srgb, var(--accent) 55%, transparent);
	}
	.col-h {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 42px;
		padding: 0 10px 0 14px;
		font-weight: 600;
		flex-shrink: 0;
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
	.limit {
		color: var(--text-3);
		font-size: var(--fs-xs);
		font-weight: 400;
	}
	.limit.over {
		color: var(--orange);
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
	.col-sub {
		padding: 0 14px 8px;
		margin-top: -6px;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.cards {
		padding: 0 8px 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow-y: auto;
		min-height: 0;
	}
	.kc {
		position: relative;
		background: var(--raise);
		border: 1px solid var(--line-2);
		border-radius: var(--r-md);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		cursor: grab;
	}
	.kc:hover {
		border-color: var(--line-3);
	}
	.kc.on {
		border-color: var(--accent);
	}
	.kc.dragging {
		opacity: 0.4;
	}
	.kc.done .kt {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.area {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
		font-size: var(--fs-xs);
	}
	.kt {
		color: var(--text);
		font-size: var(--fs-md);
		line-height: 1.4;
		padding-right: 18px;
	}
	.wait {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.wait .material-symbols-outlined {
		font-size: 15px;
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
		background: var(--raise);
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
		border: 1px solid var(--accent);
		border-radius: var(--r-md);
		background: var(--bg);
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
