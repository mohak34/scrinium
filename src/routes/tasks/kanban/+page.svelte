<script lang="ts">
	import { onMount } from 'svelte';
	import {
		tasks,
		loadTasks,
		createTask,
		updateTask,
		deleteTask,
		isOverdue,
		dueLabel,
		parseDueInput,
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

	let dragId = $state<string | null>(null);
	let overCol = $state<TaskStatus | null>(null);
	let overId = $state<string | null>(null);

	onMount(() => {
		loadTasks();
	});

	const cols = $derived.by(() =>
		COLS.map((c) => ({
			...c,
			rows: $tasks.filter((t) => t.status === c.key).sort((a, b) => a.position - b.position)
		}))
	);

	async function handleAdd() {
		const title = newTitle.trim();
		if (!title || adding) return;
		adding = true;
		try {
			const row = await createTask({ title, status: newCol, due_at: parseDueInput(newDue) });
			if (row) {
				newTitle = '';
				newDue = '';
			}
		} finally {
			adding = false;
		}
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
		dragId = null;
		overCol = null;
		overId = null;
		if (!id) return;
		const moving = $tasks.find((t) => t.id === id);
		if (!moving) return;
		// Order within the target column excluding the dragged card.
		const rows = $tasks
			.filter((t) => t.status === col && t.id !== id)
			.sort((a, b) => a.position - b.position);
		let idx = rows.length;
		if (overId) {
			const at = rows.findIndex((t) => t.id === overId);
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
		const rows = $tasks
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
	<div class="addrow">
		<input
			class="text-input title-in"
			placeholder="New task, Enter to add"
			bind:value={newTitle}
			onkeydown={(e) => {
				if (e.key === 'Enter') void handleAdd();
			}}
		/>
		<select class="text-input sel" bind:value={newCol} aria-label="Column">
			<option value="todo">Todo</option>
			<option value="doing">Doing</option>
			<option value="done">Done</option>
		</select>
		<input class="text-input date-in" type="date" bind:value={newDue} aria-label="Due date" />
		<button class="btn primary" disabled={!newTitle.trim() || adding} onclick={() => void handleAdd()}>
			{adding ? 'Adding…' : 'Add'}
		</button>
	</div>

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
					<span class="dot" class:todo={col.key === 'todo'} class:doing={col.key === 'doing'} class:done={col.key === 'done'}></span>
					<span class="clabel">{col.label}</span>
					<span class="ccount">{col.rows.length}</span>
				</div>
				<div class="cards">
					{#each col.rows as t (t.id)}
						<article
							class="card"
							class:dragging={dragId === t.id}
							class:insert={overId === t.id && dragId && dragId !== t.id}
							draggable="true"
							ondragstart={(e) => onDragStart(t, e)}
							ondragend={onDragEnd}
							ondragover={(e) => onCardOver(t.id, e)}
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
								<span class="due" class:overdue={isOverdue(t)} class:done={t.status === 'done'}>
									<span class="material-symbols-outlined mini">event</span>
									{dueLabel(t.due_at)}
								</span>
								{#if t.remind_min != null}
									<span class="rem" title="Reminder set">
										<span class="material-symbols-outlined mini">notifications</span>
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
						</article>
					{/each}
					{#if col.rows.length === 0}
						<div class="drop-hint">Drop here</div>
					{/if}
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.content {
		max-width: 1100px;
		margin: 0 auto;
		width: 100%;
		padding: 16px var(--gutter) 48px;
	}
	.addrow {
		display: flex;
		gap: 8px;
		margin-bottom: 14px;
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
	.sel {
		width: 96px;
		flex-shrink: 0;
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
	.board {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		align-items: start;
	}
	@media (max-width: 800px) {
		.board {
			grid-template-columns: 1fr;
		}
	}
	.col {
		background: var(--surface-container-lowest);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		min-height: 200px;
		display: flex;
		flex-direction: column;
	}
	.col.over {
		border-color: var(--primary);
	}
	.chead {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border-default);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--outline);
		flex-shrink: 0;
	}
	.dot.todo {
		background: var(--secondary);
	}
	.dot.doing {
		background: var(--tertiary);
	}
	.dot.done {
		background: var(--success);
	}
	.clabel {
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
	}
	.ccount {
		margin-left: auto;
		font-size: var(--font-ui-micro);
		color: var(--outline);
		font-variant-numeric: tabular-nums;
	}
	.cards {
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.card {
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 8px 10px;
		cursor: grab;
	}
	.card:active {
		cursor: grabbing;
	}
	.card.dragging {
		opacity: 0.4;
	}
	.card.insert {
		box-shadow: 0 -2px 0 var(--primary);
	}
	.t-in {
		background: none;
		border: none;
		outline: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		padding: 0;
		width: 100%;
		cursor: text;
	}
	.detail {
		margin-top: 2px;
		font-size: var(--font-ui-micro);
		color: var(--outline);
		white-space: pre-wrap;
	}
	.meta {
		margin-top: 6px;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--font-ui-micro);
		color: var(--outline);
	}
	.due {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.due.overdue {
		color: var(--error);
	}
	.due.done {
		opacity: 0.6;
	}
	.rem {
		display: inline-flex;
	}
	.mini {
		font-size: 14px;
	}
	.ops {
		margin-left: auto;
		display: flex;
		gap: 0;
		opacity: 0;
	}
	.card:hover .ops {
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
	.op.del:hover {
		color: var(--error);
	}
	.drop-hint {
		padding: 16px;
		text-align: center;
		color: var(--outline-variant);
		font-size: var(--font-ui-micro);
	}
</style>
