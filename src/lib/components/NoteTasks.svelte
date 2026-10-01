<script lang="ts">
	import { goto } from '$app/navigation';
	import { activePath, flushSave } from '$lib/stores/vault';
	import {
		createTask,
		updateTask,
		addTaskLink,
		openTask,
		isOverdue,
		isDueToday,
		dueLabel,
		type Task
	} from '$lib/stores/tasks';
	import PanelSection from './PanelSection.svelte';

	// Tasks linked to the open note. Adding here creates an Inbox task that is
	// already linked back, so planning in a note never loses the thread.
	let rows = $state<Task[]>([]);
	let adding = $state(false);
	let draft = $state('');

	$effect(() => {
		const path = $activePath;
		rows = [];
		if (!path) return;
		let cancelled = false;
		fetch(`/api/tasks?note=${encodeURIComponent(path)}`)
			.then((res) => (res.ok ? (res.json() as Promise<Task[]>) : []))
			.then((r) => {
				if (!cancelled) rows = r;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	async function add() {
		const title = draft.trim();
		const path = $activePath;
		if (!title || !path) return;
		draft = '';
		const t = await createTask({ title, status: 'inbox' });
		if (!t) return;
		await addTaskLink(t.id, path);
		rows = [...rows, { ...t, link_count: 1 }];
	}

	async function toggle(t: Task) {
		const row = await updateTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' });
		if (row) rows = rows.map((r) => (r.id === row.id ? row : r));
	}

	async function open(t: Task) {
		await flushSave();
		openTask(t.id);
		goto('/tasks');
	}

	function icon(t: Task): string {
		if (t.status === 'done') return 'check_circle';
		if (t.status === 'doing') return 'clock_loader_40';
		if (t.status === 'waiting') return 'hourglass_top';
		return 'radio_button_unchecked';
	}
</script>

{#if $activePath}
	<PanelSection icon="task_alt" title="Linked tasks" count={rows.length}>
		{#snippet action()}
			<button class="ib" title="Add a task for this note" onclick={() => (adding = !adding)}>
				<span class="material-symbols-outlined">add</span>
			</button>
		{/snippet}
		{#if adding}
			<input
				class="add"
				placeholder="New task, Enter to add"
				bind:value={draft}
				onkeydown={(e) => {
					if (e.key === 'Enter') void add();
					if (e.key === 'Escape') adding = false;
				}}
			/>
		{/if}
		{#each rows as t (t.id)}
			<div class="row" class:done={t.status === 'done'}>
				<button class="st {t.status}" title="Toggle done" onclick={() => void toggle(t)}>
					<span class="material-symbols-outlined" class:fill={t.status === 'done'}>{icon(t)}</span>
				</button>
				<button class="title" onclick={() => void open(t)}>{t.title}</button>
				{#if t.due_at != null}
					<span
						class="due"
						class:over={isOverdue(t)}
						class:today={isDueToday(t) && t.status !== 'done'}>{dueLabel(t.due_at)}</span
					>
				{/if}
			</div>
		{:else}
			{#if !adding}<p class="empty">No tasks point at this note.</p>{/if}
		{/each}
	</PanelSection>
{/if}

<style>
	.ib {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.ib:hover {
		background: var(--hover);
		color: var(--text);
	}
	.add {
		width: 100%;
		height: 30px;
		margin: 4px 0;
		padding: 0 10px;
		border: 1px solid var(--accent);
		border-radius: var(--r);
		background: var(--bg);
		color: var(--text);
		font: var(--fs) var(--font-ui);
		outline: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding: 0 6px 0 4px;
		border-radius: var(--r);
	}
	.row:hover {
		background: var(--hover);
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
	.st:hover {
		color: var(--accent);
	}
	.st.doing {
		color: var(--accent);
	}
	.st.done {
		color: var(--green);
	}
	.title {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		padding: 0;
		color: var(--text);
		font: var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row.done .title {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.due {
		font-size: var(--fs-xs);
		color: var(--text-3);
		white-space: nowrap;
	}
	.due.over {
		color: var(--red);
	}
	.due.today {
		color: var(--accent);
	}
	.empty {
		margin: 4px 4px 2px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
</style>
