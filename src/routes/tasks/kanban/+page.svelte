<script lang="ts">
	import { onMount } from 'svelte';
	import {
		tasks,
		loadTasks,
		createTask,
		updateTask,
		deleteTask,
		openTask,
		topLevel,
		childrenOf,
		isOverdue,
		isDueToday,
		dueLabel,
		parseDueInput,
		stampShort,
		type Task,
		type TaskStatus
	} from '$lib/stores/tasks';

	const COLS: { key: TaskStatus; label: string }[] = [
		{ key: 'todo', label: 'Todo' },
		{ key: 'doing', label: 'Doing' },
		{ key: 'done', label: 'Done' }
	];

	let newTitle = $state('');
	let newDue = $state('');
	let newCol = $state<TaskStatus>('todo');
	let adding = $state(false);
	let addingTo = $state<TaskStatus | null>(null);

	let dragId = $state<string | null>(null);
	let overCol = $state<TaskStatus | null>(null);
	let overId = $state<string | null>(null);

	onMount(() => {
		loadTasks();
	});

	const cols = $derived.by(() =>
		COLS.map((c) => ({
			...c,
			rows: topLevel($tasks)
				.filter((t) => t.status === c.key)
				.sort((a, b) => a.position - b.position)
		}))
	);

	const openCount = $derived(topLevel($tasks).filter((t) => t.status !== 'done').length);
	const overdueCount = $derived(topLevel($tasks).filter(isOverdue).length);
	const dueTodayCount = $derived(
		topLevel($tasks).filter((t) => t.status !== 'done' && isDueToday(t)).length
	);

	// Clicking a card opens the detail drawer; drags and controls are exempt.
	function cardClick(t: Task, e: MouseEvent) {
		if (dragId) return;
		const el = e.target as HTMLElement;
		if (el.closest('input,select,button,textarea,a')) return;
		openTask(t.id);
	}

	async function handleAdd() {
		const title = newTitle.trim();
		if (!title || adding) return;
		adding = true;
		try {
			const row = await createTask({ title, status: newCol, due_at: parseDueInput(newDue) });
			if (row) {
				newTitle = '';
				newDue = '';
				addingTo = null;
			}
		} finally {
			adding = false;
		}
	}

	function startAdd(col: TaskStatus) {
		newCol = col;
		newTitle = '';
		newDue = '';
		addingTo = col;
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
		overCol = null;
		overId = null;
	}

	function onColOver(col: TaskStatus, e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		overCol = col;
		overId = null;
	}

	function onCardOver(id: string, e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		overId = id;
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}

	async function onDrop(col: TaskStatus, e: DragEvent) {
		e.preventDefault();
		const id = dragId ?? e.dataTransfer?.getData('text/plain');
		const targetId = overId;
		dragId = null;
		overCol = null;
		overId = null;
		if (!id) return;
		const moving = $tasks.find((t) => t.id === id);
		if (!moving) return;
		// Order within the target column excluding the dragged card.
		const rows = topLevel($tasks)
			.filter((t) => t.status === col && t.id !== id)
			.sort((a, b) => a.position - b.position);
		let idx = rows.length;
		if (targetId) {
			const at = rows.findIndex((t) => t.id === targetId);
			if (at !== -1) idx = at;
		}
		const prev = rows[idx - 1]?.position;
		const next = rows[idx]?.position;
		let position: number;
		if (prev != null && next != null) position = (prev + next) / 2;
		else if (prev != null) position = prev + 1000;
		else if (next != null) position = next - 1000;
		else position = Date.now();
		if (moving.status === col && moving.position === position) return;
		await updateTask(id, { status: col, position });
	}

	async function shiftColumn(t: Task, dir: 1 | -1) {
		const order: TaskStatus[] = ['todo', 'doing', 'done'];
		const next = order[order.indexOf(t.status) + dir];
		if (!next) return;
		await updateTask(t.id, { status: next, position: Date.now() });
	}

	async function shiftOrder(t: Task, dir: 1 | -1) {
		const rows = topLevel($tasks)
			.filter((x) => x.status === t.status)
			.sort((a, b) => a.position - b.position);
		const i = rows.findIndex((x) => x.id === t.id);
		const other = rows[i + dir];
		if (!other) return;
		// Swap positions so order flips without renumbering the column.
		await updateTask(t.id, { position: other.position });
		await updateTask(other.id, { position: t.position });
	}
</script>

<div class="content">
	<div class="page-heading">
		<h1>Board</h1>
		<span class="heading-count">{openCount} open</span>
	</div>
	{#if overdueCount > 0 || dueTodayCount > 0}
		<div class="stats" aria-label="Task summary">
			{#if overdueCount > 0}
				<span class="stat over"><strong>{overdueCount}</strong> overdue</span>
			{/if}
			{#if dueTodayCount > 0}
				<span class="stat today"><strong>{dueTodayCount}</strong> due today</span>
			{/if}
		</div>
	{/if}

	<div class="board">
		{#each cols as col (col.key)}
			<section
				class="col"
				class:over={overCol === col.key && dragId}
				ondragover={(e) => onColOver(col.key, e)}
				ondrop={(e) => void onDrop(col.key, e)}
				aria-label={col.label}
			>
				<div class="chead">
					<span class="clabel">{col.label}</span>
					<span class="ccount">{col.rows.length}</span>
				</div>
				<div class="cards">
					{#each col.rows as t (t.id)}
						<div
							class="card {t.status}"
							class:dragging={dragId === t.id}
							class:insert={overId === t.id && dragId && dragId !== t.id}
							draggable="true"
							ondragstart={(e) => onDragStart(t, e)}
							ondragend={onDragEnd}
							ondragover={(e) => onCardOver(t.id, e)}
							onclick={(e) => cardClick(t, e)}
							role="button"
							tabindex="0"
							aria-label="Open {t.title} details"
							onkeydown={(e) => {
								if (e.key === 'Enter' && (e.target as HTMLElement).classList.contains('card'))
									openTask(t.id);
							}}
						>
							<input
								class="t-in"
								value={t.title}
								aria-label="Task title"
								draggable="false"
								onmousedown={(e) => e.stopPropagation()}
								onchange={(e) => {
									const v = (e.target as HTMLInputElement).value.trim();
									if (v && v !== t.title) void updateTask(t.id, { title: v });
									else (e.target as HTMLInputElement).value = t.title;
								}}
							/>
							{#if t.detail}
								<div class="detail">{t.detail}</div>
							{/if}
							<div class="meta">
								<span
									class="due"
									class:overdue={isOverdue(t)}
									class:today={isDueToday(t) && t.status !== 'done'}
									class:done={t.status === 'done'}
								>
									<span class="material-symbols-outlined mini">event</span>
									{dueLabel(t.due_at)}
								</span>
								{#if t.remind_at != null}
									<span class="rem" title="Reminds {stampShort(t.remind_at)}">
										<span class="material-symbols-outlined mini">notifications</span>
									</span>
								{/if}
								{#if t.priority !== 'none'}
									<span class="pri pri-{t.priority}">{t.priority}</span>
								{/if}
								{#if childrenOf($tasks, t.id).length > 0}
									<span
										class="sub-c"
										title="{childrenOf($tasks, t.id).filter((s) => s.status === 'done').length} of {childrenOf($tasks, t.id).length} subtasks done"
									>
										<span class="material-symbols-outlined mini">account_tree</span>
										{childrenOf($tasks, t.id).filter((s) => s.status === 'done').length}/{childrenOf(
											$tasks,
											t.id
										).length}
									</span>
								{/if}
								{#if t.link_count > 0}
									<span
										class="linked"
										title={t.link_count === 1 ? '1 linked note' : `${t.link_count} linked notes`}
									>
										<span class="material-symbols-outlined mini">description</span>
										{t.link_count}
									</span>
								{/if}
								<span class="ops">
									<button class="op" title="Move left" onclick={() => void shiftColumn(t, -1)}>
										<span class="material-symbols-outlined mini">chevron_left</span>
									</button>
									<button class="op" title="Move up" onclick={() => void shiftOrder(t, -1)}>
										<span class="material-symbols-outlined mini">expand_less</span>
									</button>
									<button class="op" title="Move down" onclick={() => void shiftOrder(t, 1)}>
										<span class="material-symbols-outlined mini">expand_more</span>
									</button>
									<button class="op" title="Move right" onclick={() => void shiftColumn(t, 1)}>
										<span class="material-symbols-outlined mini">chevron_right</span>
									</button>
									<button
										class="op del"
										title="Delete"
										onclick={() => {
											if (confirm(`Delete "${t.title}"?`)) void deleteTask(t.id);
										}}
									>
										<span class="material-symbols-outlined mini">delete</span>
									</button>
								</span>
							</div>
						</div>
					{/each}
					{#if col.rows.length === 0}
						<div class="drop-hint">No tasks in {col.label.toLowerCase()}</div>
					{/if}
					{#if addingTo === col.key}
						<div class="inline-add">
							<input class="title-in" bind:value={newTitle} placeholder="Task name" aria-label="New task title" onkeydown={(e) => { if (e.key === 'Enter') void handleAdd(); if (e.key === 'Escape') addingTo = null; }} />
							<div class="add-actions">
								<input class="ctl date-in" type="date" bind:value={newDue} aria-label="Due date" />
								<button class="cancel-btn" onclick={() => (addingTo = null)}>Cancel</button>
								<button class="add-btn" disabled={!newTitle.trim() || adding} onclick={() => void handleAdd()}>{adding ? 'Adding…' : 'Add'}</button>
							</div>
						</div>
					{:else}
						<button class="add-in-column" onclick={() => startAdd(col.key)}><span class="material-symbols-outlined">add</span> Add task</button>
					{/if}
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.content {
		max-width: 1440px;
		margin: 0 auto;
		width: 100%;
		padding: 32px 24px 72px;
	}
	.page-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 24px;
	}
	h1 {
		margin: 0;
		font-size: 24px;
		line-height: 30px;
		font-weight: 600;
		letter-spacing: -0.035em;
	}
	.heading-count {
		color: var(--on-surface-variant);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.title-in {
		width: 100%;
		background: none;
		border: none;
		outline: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-medium);
		height: 30px;
	}
	.title-in::placeholder {
		color: var(--outline-variant);
	}
	.ctl {
		height: 30px;
		padding: 0 8px;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		outline: none;
		flex-shrink: 0;
	}
	.ctl:focus {
		border-color: var(--primary);
	}
	.date-in {
		width: 132px;
		color-scheme: dark;
	}
	.add-btn {
		height: 30px;
		padding: 0 14px;
		background: var(--primary);
		border: 1px solid var(--primary);
		border-radius: var(--radius);
		color: var(--on-primary);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.add-btn:hover:not(:disabled) {
		filter: brightness(1.08);
	}
	.add-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.stats {
		display: flex;
		gap: 14px;
		margin: 0 2px 16px;
		min-height: 16px;
		font-size: 11px;
		color: var(--outline);
		font-variant-numeric: tabular-nums;
	}
	.stat strong {
		color: var(--on-surface-variant);
		font-weight: var(--font-ui-medium-weight);
	}
	.stat.over strong {
		color: var(--error);
	}
	.stat.today strong {
		color: var(--tertiary);
	}

	.board {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0;
		align-items: stretch;
	}
	@media (max-width: 760px) {
		.board {
			grid-template-columns: 1fr;
		}
	}

	.col {
		padding: 0 14px;
		min-height: 320px;
		display: flex;
		flex-direction: column;
		transition: background-color 0.12s ease;
	}
	.col:first-child { padding-left: 0; }
	.col:last-child { padding-right: 0; }
	.col + .col { border-left: 1px solid var(--border-default); }
	.col.over {
		background: var(--surface-container-low);
	}
	.chead {
		display: flex;
		align-items: baseline;
		gap: 7px;
		padding: 10px 2px 12px;
		border-bottom: 1px solid var(--border-default);
	}
	.clabel {
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
	}
	.ccount {
		margin-left: auto;
		min-width: 20px;
		text-align: center;
		font-size: var(--font-ui-micro);
		color: var(--on-surface-variant);
		padding: 1px 3px;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	.cards {
		padding: 10px 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.add-in-column {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-height: 36px;
		padding: 0 10px;
		border: 1px dashed transparent;
		border-radius: var(--radius);
		background: none;
		color: var(--outline);
		font: 12px var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.add-in-column .material-symbols-outlined { font-size: 16px; }
	.add-in-column:hover { border-color: var(--border-strong); background: var(--surface-container); color: var(--on-surface); }
	.inline-add {
		padding: 10px;
		border: 1px solid var(--primary);
		border-radius: var(--radius-md);
		background: var(--surface-container-lowest);
	}
	.add-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
	.cancel-btn {
		margin-left: auto;
		padding: 0 6px;
		height: 30px;
		border: 0;
		background: none;
		color: var(--on-surface-variant);
		font: 12px var(--font-ui);
		cursor: pointer;
	}
	.cancel-btn:hover { color: var(--on-surface); }

	.card {
		position: relative;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 12px;
		cursor: grab;
		overflow: hidden;
		transition: border-color 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
	}
	.card:hover {
		border-color: var(--border-strong);
	}
	.card:active {
		cursor: grabbing;
	}
	.card.dragging {
		opacity: 0.35;
	}
	.card.insert {
		box-shadow: 0 -2px 0 var(--primary);
	}
	.card.done .t-in {
		color: var(--outline);
		text-decoration: line-through;
	}
	.t-in {
		background: none;
		border: none;
		outline: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: 13px;
		font-weight: var(--font-ui-medium-weight);
		line-height: 1.45;
		padding: 0;
		width: 100%;
		cursor: text;
		border-radius: 2px;
	}
	.t-in:focus-visible {
		outline: 1px solid var(--primary);
		outline-offset: 2px;
	}
	.detail {
		margin-top: 5px;
		font-size: var(--font-ui-micro);
		line-height: 1.5;
		color: var(--outline);
		white-space: pre-wrap;
	}
	.meta {
		margin-top: 12px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 9px;
		font-size: var(--font-ui-micro);
		color: var(--outline);
		font-variant-numeric: tabular-nums;
	}
	.due {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.due.overdue {
		color: var(--error);
		font-weight: var(--font-ui-medium-weight);
	}
	.due.today {
		color: var(--tertiary);
	}
	.due.done {
		opacity: 0.6;
	}
	.rem {
		display: inline-flex;
		color: var(--outline-variant);
	}
	.pri {
		text-transform: capitalize;
	}
	.pri-urgent {
		color: var(--error);
		font-weight: var(--font-ui-medium-weight);
	}
	.pri-high {
		color: var(--tertiary);
	}
	.pri-medium {
		color: var(--primary);
	}
	.pri-low {
		color: var(--outline);
	}
	.sub-c,
	.linked {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--outline-variant);
	}
	.mini {
		font-size: 14px;
	}
	.ops {
		margin-left: auto;
		display: flex;
		opacity: 0;
	}
	.card:hover .ops,
	.card:focus-within .ops {
		opacity: 1;
	}
	.op {
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--on-surface-variant);
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
	}
	.op:hover {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.op:focus-visible {
		outline: 1px solid var(--primary);
		opacity: 1;
	}
	.op.del:hover {
		color: var(--error);
	}
	.drop-hint {
		margin: 2px;
		padding: 32px 12px;
		text-align: center;
		color: var(--outline-variant);
		font-size: var(--font-ui-micro);
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-md);
	}
	@media (max-width: 600px) {
		.content { padding: 24px 16px 56px; }
		.page-heading { margin-bottom: 20px; }
		.date-in { min-width: 0; flex: 1; }
		.col { min-height: 160px; }
		.ops { opacity: 1; }
	}
	@media (max-width: 760px) {
		.col, .col:first-child, .col:last-child { padding: 0; }
		.col + .col { border-left: 0; border-top: 1px solid var(--border-default); margin-top: 16px; padding-top: 16px; }
	}

	button:focus-visible,
	input:focus-visible {
		outline: 1px solid var(--primary);
		outline-offset: 1px;
	}

	@media (prefers-reduced-motion: reduce) {
		.col,
		.card {
			transition: none;
		}
	}
</style>
