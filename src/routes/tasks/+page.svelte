<script lang="ts">
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
		startOfToday,
		isOverdue,
		isDueToday,
		dueLabel,
		parseDueInput,
		stampShort,
		AREAS,
		type Task,
		type TaskArea,
		type TaskStatus
	} from '$lib/stores/tasks';
	import { areaMeta } from '$lib/taskModel';
	import AppSwitcher from '$lib/components/AppSwitcher.svelte';
	import PageFooter from '$lib/components/PageFooter.svelte';
	import { onMount } from 'svelte';

	let newTitle = $state('');
	let newDue = $state('');
	let newArea = $state<TaskArea | ''>('');
	let adding = $state(false);
	let query = $state('');
	let searching = $state(false);
	type TaskFilter = 'all' | 'today' | 'overdue' | 'upcoming' | 'undated' | 'completed';
	let filter = $state<TaskFilter>('all');
	let area = $state<TaskArea | null>(null);
	const filters: { key: TaskFilter; label: string; icon: string }[] = [
		{ key: 'all', label: 'All open', icon: 'inbox' },
		{ key: 'today', label: 'Today', icon: 'today' },
		{ key: 'overdue', label: 'Overdue', icon: 'event_busy' },
		{ key: 'upcoming', label: 'Upcoming', icon: 'date_range' },
		{ key: 'undated', label: 'No date', icon: 'calendar_clock' },
		{ key: 'completed', label: 'Completed', icon: 'check_circle' }
	];

	onMount(() => {
		void loadTasks();
	});

	const tomorrow = () => startOfToday() + 86400000;

	function matchesFilter(t: Task, f: TaskFilter): boolean {
		if (f === 'completed') return t.status === 'done';
		if (t.status === 'done') return false;
		if (f === 'today') return isDueToday(t);
		if (f === 'overdue') return isOverdue(t);
		if (f === 'upcoming') return t.due_at != null && t.due_at >= tomorrow();
		if (f === 'undated') return t.due_at == null;
		return true;
	}

	const inArea = $derived(topLevel($tasks).filter((t) => area == null || t.area === area));

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return inArea.filter(
			(t) =>
				matchesFilter(t, filter) &&
				(!q || t.title.toLowerCase().includes(q) || t.detail.toLowerCase().includes(q))
		);
	});

	interface Group {
		key: string;
		label: string;
		rows: Task[];
	}

	const groups = $derived.by((): Group[] => {
		const open = visible.filter((t) => t.status !== 'done');
		const done = visible.filter((t) => t.status === 'done');
		const byDue = [...open].sort((a, b) => (a.due_at ?? Infinity) - (b.due_at ?? Infinity));
		const out: Group[] = [
			{ key: 'overdue', label: 'Overdue', rows: byDue.filter(isOverdue) },
			{ key: 'today', label: 'Today', rows: byDue.filter((t) => !isOverdue(t) && isDueToday(t)) },
			{
				key: 'upcoming',
				label: 'Upcoming',
				rows: byDue.filter((t) => t.due_at != null && t.due_at >= tomorrow())
			},
			{ key: 'nodate', label: 'No date', rows: byDue.filter((t) => t.due_at == null) }
		].filter((g) => g.rows.length > 0);
		if (done.length > 0) {
			out.push({ key: 'done', label: 'Done', rows: [...done].sort((a, b) => b.updated_at - a.updated_at) });
		}
		return out;
	});

	const counts = $derived(
		Object.fromEntries(filters.map((f) => [f.key, inArea.filter((t) => matchesFilter(t, f.key)).length])) as Record<
			TaskFilter,
			number
		>
	);
	const areaCounts = $derived(
		Object.fromEntries(
			AREAS.map((a) => [a.key, topLevel($tasks).filter((t) => t.area === a.key && t.status !== 'done').length])
		) as Record<TaskArea, number>
	);
	const openCount = $derived(topLevel($tasks).filter((t) => t.status !== 'done').length);
	const overdueCount = $derived(topLevel($tasks).filter(isOverdue).length);
	const heading = $derived(
		(area ? `${areaMeta(area).label}: ` : '') + filters.find((f) => f.key === filter)!.label
	);

	// Clicking a row opens the detail drawer. Interactive controls stop the
	// trip by matching the closest control, not by per-element handlers.
	function rowClick(t: Task, e: MouseEvent) {
		const el = e.target as HTMLElement;
		if (el.closest('input,select,button,textarea,a')) return;
		openTask(t.id);
	}

	async function handleAdd() {
		const title = newTitle.trim();
		if (!title || adding) return;
		adding = true;
		try {
			const due = parseDueInput(newDue);
			// A dated task is already planned; undated ones land in the Inbox.
			const row = await createTask({
				title,
				due_at: due,
				status: due == null ? 'inbox' : 'todo',
				area: newArea || area
			});
			if (row) {
				newTitle = '';
				newDue = '';
				if (filter === 'completed') filter = 'all';
			}
		} finally {
			adding = false;
		}
	}

	// The circle advances a task one step toward done; done reopens it.
	function nextStatus(t: Task): TaskStatus {
		if (t.status === 'done') return 'todo';
		if (t.status === 'doing' || t.status === 'waiting') return 'done';
		return 'doing';
	}

	function statusIcon(s: TaskStatus): string {
		if (s === 'done') return 'check_circle';
		if (s === 'doing') return 'clock_loader_40';
		if (s === 'waiting') return 'hourglass_top';
		return 'radio_button_unchecked';
	}

	async function handleDelete(t: Task) {
		if (!confirm(`Delete "${t.title}"?`)) return;
		await deleteTask(t.id);
	}

	function subCount(t: Task): string | null {
		const kids = childrenOf($tasks, t.id);
		if (kids.length === 0) return null;
		return `${kids.filter((k) => k.status === 'done').length}/${kids.length}`;
	}
</script>

<div class="page">
	<aside class="side" aria-label="Task filters">
		<div class="side-head"><AppSwitcher current="tasks" /></div>
		<nav class="filters">
			{#each filters as item (item.key)}
				<button
					class="filt"
					class:on={filter === item.key}
					class:red={item.key === 'overdue' && counts.overdue > 0}
					onclick={() => (filter = item.key)}
					aria-current={filter === item.key ? 'page' : undefined}
				>
					<span class="material-symbols-outlined" class:fill={filter === item.key}>{item.icon}</span>
					<span class="fl">{item.label}</span>
					<span class="n">{counts[item.key]}</span>
				</button>
			{/each}
		</nav>
		<div class="grp">Areas</div>
		<nav class="filters">
			{#each AREAS as a (a.key)}
				<button
					class="filt"
					class:on={area === a.key}
					onclick={() => (area = area === a.key ? null : a.key)}
					aria-pressed={area === a.key}
				>
					<i class="dot" style="background: {a.color}"></i>
					<span class="fl">{a.label}</span>
					<span class="n">{areaCounts[a.key]}</span>
				</button>
			{/each}
		</nav>
	</aside>

	<main class="main">
		<header class="page-h">
			<h1>{heading}</h1>
			<span class="cnt">{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span>
			<span class="sp"></span>
			{#if searching || query}
				<input
					class="search"
					placeholder="Search tasks"
					bind:value={query}
					aria-label="Search tasks"
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							query = '';
							searching = false;
						}
					}}
					{@attach (el) => el.focus()}
				/>
			{:else}
				<button class="ib" title="Search tasks" onclick={() => (searching = true)}>
					<span class="material-symbols-outlined">search</span>
				</button>
			{/if}
		</header>

		<div class="adder">
			<span class="material-symbols-outlined">add</span>
			<input
				class="title-in"
				placeholder="Add a task, press Enter"
				bind:value={newTitle}
				aria-label="New task title"
				onkeydown={(e) => {
					if (e.key === 'Enter') void handleAdd();
				}}
			/>
			<select class="ctl" bind:value={newArea} aria-label="Area">
				<option value="">{area ? areaMeta(area).label : 'No area'}</option>
				{#each AREAS as a (a.key)}
					<option value={a.key}>{a.label}</option>
				{/each}
			</select>
			<input class="ctl" type="date" bind:value={newDue} aria-label="Due date" />
			<button class="add-btn" disabled={!newTitle.trim() || adding} onclick={() => void handleAdd()}>
				Add
			</button>
		</div>

		<div class="list">
			{#if $tasks.length === 0}
				<div class="empty">
					<span class="material-symbols-outlined">task_alt</span>
					<p>No tasks yet. Type one above and press Enter.</p>
				</div>
			{:else if visible.length === 0}
				<div class="empty">
					<p>{query.trim() ? 'No tasks match that search.' : 'Nothing here.'}</p>
				</div>
			{:else}
				{#each groups as group (group.key)}
					<section>
						<h2 class="lg" class:over={group.key === 'overdue'}>
							{group.label}<span class="n">{group.rows.length}</span>
						</h2>
						{#each group.rows as t (t.id)}
							<div
								class="tr"
								class:done={t.status === 'done'}
								class:on={$openTaskId === t.id}
								onclick={(e) => rowClick(t, e)}
								role="button"
								tabindex="0"
								aria-label="Open {t.title} details"
								onkeydown={(e) => {
									if (e.key === 'Enter' && (e.target as HTMLElement).classList.contains('tr'))
										openTask(t.id);
								}}
							>
								<button
									class="st {t.status}"
									title="Advance status"
									onclick={() => void updateTask(t.id, { status: nextStatus(t) })}
								>
									<span class="material-symbols-outlined" class:fill={t.status === 'done'}
										>{statusIcon(t.status)}</span
									>
								</button>
								<input
									class="ttl"
									value={t.title}
									aria-label="Task title"
									onchange={(e) => {
										const v = (e.target as HTMLInputElement).value.trim();
										if (v && v !== t.title) void updateTask(t.id, { title: v });
										else (e.target as HTMLInputElement).value = t.title;
									}}
								/>
								<span class="meta">
									{#if t.status === 'waiting' && t.waiting_on}
										<span class="m" title="Waiting on">
											<span class="material-symbols-outlined">person</span>{t.waiting_on}
										</span>
									{/if}
									{#if t.area}
										<span class="m area"><i style="background: {areaMeta(t.area).color}"></i>{areaMeta(t.area).label}</span>
									{/if}
									{#if t.link_count > 0}
										<span class="m" title="Linked notes">
											<span class="material-symbols-outlined">description</span>{t.link_count}
										</span>
									{/if}
									{#if subCount(t)}
										<span class="m" title="Subtasks">
											<span class="material-symbols-outlined">subdirectory_arrow_right</span>{subCount(t)}
										</span>
									{/if}
									{#if t.remind_at != null}
										<span class="m" title="Reminds {stampShort(t.remind_at)}">
											<span class="material-symbols-outlined">notifications</span>
										</span>
									{/if}
									{#if t.priority !== 'none'}
										<span class="m pri-{t.priority}" title="{t.priority} priority">
											<span class="material-symbols-outlined fill">flag</span>
										</span>
									{/if}
								</span>
								<span
									class="due"
									class:over={isOverdue(t)}
									class:today={isDueToday(t) && t.status !== 'done'}
								>
									{t.due_at == null ? '' : isDueToday(t) && t.status !== 'done' ? 'Today' : dueLabel(t.due_at)}
								</span>
								<button class="del" title="Delete" onclick={() => void handleDelete(t)}>
									<span class="material-symbols-outlined">delete</span>
								</button>
							</div>
						{/each}
					</section>
				{/each}
			{/if}
		</div>
		<PageFooter>
			<span>{openCount} open</span>
			{#if overdueCount > 0}<span class="red">{overdueCount} overdue</span>{/if}
		</PageFooter>
	</main>
</div>

<style>
	.page {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.side {
		width: 240px;
		flex-shrink: 0;
		background: var(--panel);
		border-right: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}
	.side-head {
		height: 56px;
		display: flex;
		align-items: center;
		padding: 0 16px;
		flex-shrink: 0;
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0 8px;
	}
	.filt {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 32px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.filt .material-symbols-outlined {
		font-size: 18px;
		color: var(--text-3);
	}
	.filt:hover {
		background: var(--hover);
		color: var(--text);
	}
	.filt.on {
		background: var(--accent-dim);
		color: var(--text);
	}
	.filt.on .material-symbols-outlined {
		color: var(--accent);
	}
	.fl {
		flex: 1;
	}
	.n {
		color: var(--text-3);
		font-size: var(--fs-xs);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	.filt.red .n {
		color: var(--red);
	}
	.dot {
		width: 8px;
		height: 8px;
		margin: 0 5px;
		border-radius: 2px;
	}
	.grp {
		padding: 20px 18px 6px;
		color: var(--text-3);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.main {
		flex: 1;
		min-width: 0;
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
	h1 {
		margin: 0;
		font: 700 20px var(--font-read);
		white-space: nowrap;
	}
	.cnt {
		color: var(--text-3);
		white-space: nowrap;
	}
	.sp {
		flex: 1;
	}
	.ib {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.ib:hover {
		background: var(--hover);
		color: var(--text);
	}
	.search {
		width: 240px;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--accent);
		border-radius: var(--r-md);
		background: var(--bg);
		color: var(--text);
		font: var(--fs) var(--font-ui);
		outline: none;
	}
	.adder {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 48px;
		margin: 18px 24px 4px;
		padding: 0 8px 0 14px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		color: var(--text-3);
		flex-shrink: 0;
	}
	.adder:focus-within {
		border-color: var(--line-3);
	}
	.title-in {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: var(--fs-md) var(--font-ui);
	}
	.title-in::placeholder {
		color: var(--text-3);
	}
	.ctl {
		height: 30px;
		padding: 0 8px;
		border: 1px solid transparent;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		color-scheme: dark;
		cursor: pointer;
		outline: none;
	}
	.ctl:hover,
	.ctl:focus {
		background: var(--hover);
		color: var(--text);
	}
	.add-btn {
		height: 32px;
		padding: 0 14px;
		border: none;
		border-radius: var(--r-md);
		background: var(--accent-fill);
		color: var(--on-accent);
		font: 600 var(--fs) var(--font-ui);
		cursor: pointer;
	}
	.add-btn:hover:not(:disabled) {
		background: var(--accent-fill-hi);
	}
	.add-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 24px 40px;
	}
	.lg {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 22px 6px 8px;
		border-bottom: 1px solid var(--line);
		font-size: var(--fs);
		font-weight: 600;
	}
	.lg.over {
		color: var(--red);
	}
	.tr {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) auto 96px 28px;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 0 4px 0 8px;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
	}
	.tr:hover {
		background: var(--raise);
	}
	.tr.on {
		background: var(--accent-dim);
	}
	.st {
		display: grid;
		place-items: center;
		border: none;
		background: none;
		padding: 0;
		color: var(--text-3);
		cursor: pointer;
	}
	.st .material-symbols-outlined {
		font-size: 20px;
	}
	.st:hover {
		color: var(--accent);
	}
	.st.doing {
		color: var(--accent);
	}
	.st.waiting {
		color: var(--yellow);
	}
	.st.done {
		color: var(--green);
	}
	.ttl {
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		padding: 4px 0;
		color: var(--text);
		font: var(--fs-md) var(--font-ui);
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.ttl:focus {
		cursor: text;
	}
	.tr.done .ttl {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 14px;
		color: var(--text-3);
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	.m {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.m .material-symbols-outlined {
		font-size: 15px;
	}
	.m.area i {
		width: 7px;
		height: 7px;
		border-radius: 2px;
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
	.due {
		text-align: right;
		color: var(--text-2);
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	.due.over {
		color: var(--red);
	}
	.due.today {
		color: var(--accent);
	}
	.del {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
		visibility: hidden;
	}
	.tr:hover .del {
		visibility: visible;
	}
	.del:hover {
		background: var(--hover);
		color: var(--red);
	}
	.del .material-symbols-outlined {
		font-size: 17px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 80px 0;
		color: var(--text-3);
	}
	.empty .material-symbols-outlined {
		font-size: 34px;
		color: var(--text-4);
	}
	.empty p {
		margin: 0;
	}
</style>
