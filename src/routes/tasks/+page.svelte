<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		tasks,
		loadTasks,
		createTask,
		updateTask,
		deleteTask,
		startOfToday,
		isOverdue,
		isDueToday,
		dueLabel,
		dueInputValue,
		parseDueInput,
		type Task,
		type TaskStatus
	} from '$lib/stores/tasks';

	let newTitle = $state('');
	let newDue = $state('');
	let adding = $state(false);
	let query = $state('');
	let hideDone = $state(false);

	const REMIND_OPTS = [
		{ v: null, label: 'No reminder' },
		{ v: 5, label: '5 min before' },
		{ v: 15, label: '15 min before' },
		{ v: 30, label: '30 min before' },
		{ v: 60, label: '1 hour before' },
		{ v: 1440, label: '1 day before' }
	];

	onMount(() => {
		loadTasks();
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') goto('/');
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
	});

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return $tasks.filter((t) => {
			if (hideDone && t.status === 'done') return false;
			if (!q) return true;
			return (
				t.title.toLowerCase().includes(q) || (t.detail && t.detail.toLowerCase().includes(q))
			);
		});
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
				rows: byDue.filter((t) => t.due_at != null && t.due_at >= startOfToday() + 86400000)
			},
			{ key: 'nodate', label: 'No date', rows: byDue.filter((t) => t.due_at == null) }
		].filter((g) => g.rows.length > 0);
		if (done.length > 0 && !hideDone) {
			out.push({ key: 'done', label: 'Done', rows: [...done].sort((a, b) => b.updated_at - a.updated_at) });
		}
		return out;
	});

	const openCount = $derived($tasks.filter((t) => t.status !== 'done').length);

	async function handleAdd() {
		const title = newTitle.trim();
		if (!title || adding) return;
		adding = true;
		try {
			const row = await createTask({ title, due_at: parseDueInput(newDue) });
			if (row) {
				newTitle = '';
				newDue = '';
			}
		} finally {
			adding = false;
		}
	}

	function cycleStatus(t: Task): TaskStatus {
		return t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo';
	}

	function statusIcon(s: TaskStatus): string {
		return s === 'done' ? 'check_circle' : s === 'doing' ? 'timelapse' : 'circle';
	}

	async function handleDelete(t: Task) {
		if (!confirm(`Delete "${t.title}"?`)) return;
		await deleteTask(t.id);
	}
</script>

<div class="content">
	<div class="addrow">
		<input
			class="text-input title-in"
			placeholder="New task, pick a due date, Enter to add"
			bind:value={newTitle}
			onkeydown={(e) => {
				if (e.key === 'Enter') void handleAdd();
			}}
		/>
		<input class="text-input date-in" type="date" bind:value={newDue} aria-label="Due date" />
		<button class="btn primary" disabled={!newTitle.trim() || adding} onclick={() => void handleAdd()}>
			{adding ? 'Adding…' : 'Add'}
		</button>
	</div>

	<div class="toolbar">
		<input class="text-input search" placeholder="Filter tasks" bind:value={query} />
		<label class="check">
			<input type="checkbox" bind:checked={hideDone} />
			Hide done
		</label>
		<span class="count">{openCount} open</span>
	</div>

	{#if $tasks.length === 0}
		<div class="empty">No tasks yet. Add the first one above.</div>
	{:else if visible.length === 0}
		<div class="empty">Nothing matches the filter.</div>
	{:else}
		{#each groups as group (group.key)}
			<section class="group">
				<div class="ghead">
					<span class="glabel">{group.label}</span>
					<span class="gcount">{group.rows.length}</span>
				</div>
				{#each group.rows as t (t.id)}
					<div class="row" class:done={t.status === 'done'} class:over={isOverdue(t)}>
						<button
							class="status"
							title="Cycle status"
							onclick={() => void updateTask(t.id, { status: cycleStatus(t) })}
						>
							<span class="material-symbols-outlined">{statusIcon(t.status)}</span>
						</button>
						<div class="main">
							<input
								class="t-in"
								value={t.title}
								aria-label="Task title"
								onchange={(e) => {
									const v = (e.target as HTMLInputElement).value.trim();
									if (v && v !== t.title) void updateTask(t.id, { title: v });
									else (e.target as HTMLInputElement).value = t.title;
								}}
							/>
							<div class="sub">
								<span class="due" class:overdue={isOverdue(t)}>
									<span class="material-symbols-outlined mini">event</span>
									{dueLabel(t.due_at)}
								</span>
								{#if t.remind_min != null}
									<span class="rem" title="Reminder set">
										<span class="material-symbols-outlined mini">notifications</span>
										{t.remind_min >= 60 ? `${t.remind_min / 60}h` : `${t.remind_min}m`}
									</span>
								{/if}
								{#if t.status !== 'todo'}
									<span class="st">{t.status}</span>
								{/if}
							</div>
						</div>
						<input
							class="text-input date-in row-date"
							type="date"
							value={dueInputValue(t.due_at)}
							aria-label="Due date"
							onchange={(e) =>
								void updateTask(t.id, { due_at: parseDueInput((e.target as HTMLInputElement).value) })}
						/>
						<select
							class="text-input sel"
							value={t.remind_min == null ? '' : String(t.remind_min)}
							aria-label="Reminder"
							onchange={(e) => {
								const v = (e.target as HTMLSelectElement).value;
								void updateTask(t.id, { remind_min: v === '' ? null : Number(v) });
							}}
						>
							{#each REMIND_OPTS as o (o.label)}
								<option value={o.v == null ? '' : String(o.v)}>{o.label}</option>
							{/each}
						</select>
						<select
							class="text-input sel"
							value={t.status}
							aria-label="Status"
							onchange={(e) =>
								void updateTask(t.id, { status: (e.target as HTMLSelectElement).value as TaskStatus })}
						>
							<option value="todo">Todo</option>
							<option value="doing">Doing</option>
							<option value="done">Done</option>
						</select>
						<button class="abtn del" title="Delete" onclick={() => void handleDelete(t)}>
							<span class="material-symbols-outlined">delete</span>
						</button>
					</div>
				{/each}
			</section>
		{/each}
	{/if}
</div>

<style>
	.content {
		max-width: 760px;
		margin: 0 auto;
		width: 100%;
		padding: 16px var(--gutter) 48px;
	}
	.addrow {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}
	.text-input {
		height: 30px;
		padding: 0 8px;
		background: var(--background);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		outline: none;
	}
	.text-input:focus {
		border-color: var(--primary);
	}
	.title-in {
		flex: 1;
		min-width: 0;
	}
	.date-in {
		width: 132px;
		flex-shrink: 0;
		color-scheme: dark;
	}
	.search {
		width: 200px;
	}
	.btn {
		height: 30px;
		padding: 0 12px;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
		white-space: nowrap;
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.primary {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--on-primary);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		cursor: pointer;
		user-select: none;
	}
	.check input {
		accent-color: var(--primary);
	}
	.count {
		margin-left: auto;
		font-size: var(--font-ui-micro);
		color: var(--outline);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		padding: 32px 0;
		text-align: center;
		color: var(--outline);
		font-size: var(--font-ui-small);
	}
	.group {
		margin-bottom: 20px;
	}
	.ghead {
		display: flex;
		align-items: baseline;
		gap: var(--stack-gap);
		padding-bottom: 6px;
		border-bottom: 1px solid var(--border-default);
	}
	.glabel {
		font-size: var(--font-label-caps);
		line-height: var(--font-label-caps-lh);
		font-weight: var(--font-label-caps-weight);
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--outline);
	}
	.gcount {
		font-size: var(--font-label-caps);
		color: var(--outline-variant);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 6px;
		border-bottom: 1px solid var(--border-default);
		border-radius: var(--radius);
	}
	.row:hover {
		background: var(--surface-container-low);
	}
	.row.done {
		opacity: 0.55;
	}
	.status {
		background: none;
		border: none;
		color: var(--on-surface-variant);
		cursor: pointer;
		padding: 2px;
		display: flex;
		flex-shrink: 0;
	}
	.status:hover {
		color: var(--primary);
	}
	.row.over .status {
		color: var(--error);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.t-in {
		background: none;
		border: none;
		outline: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		padding: 0;
		width: 100%;
	}
	.row.done .t-in {
		text-decoration: line-through;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: var(--font-ui-micro);
		color: var(--outline);
	}
	.due,
	.rem {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.due.overdue {
		color: var(--error);
	}
	.mini {
		font-size: 13px;
	}
	.st {
		text-transform: capitalize;
		color: var(--outline-variant);
	}
	.row-date {
		width: 126px;
	}
	.sel {
		width: 112px;
	}
	.abtn {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--on-surface-variant);
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}
	.abtn .material-symbols-outlined {
		font-size: 16px;
	}
	.abtn.del:hover {
		color: var(--error);
		background: var(--surface-container-high);
	}
</style>
