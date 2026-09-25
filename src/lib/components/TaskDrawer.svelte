<script lang="ts">
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import {
		tasks,
		openTaskId,
		closeTask,
		openTask,
		updateTask,
		createTask,
		deleteTask,
		childrenOf,
		loadTaskLinks,
		addTaskLink,
		removeTaskLink,
		dueInputValue,
		dueTimeValue,
		combineDateTime,
		dateTimeInputValue,
		parseDateTimeInput,
		PRIORITIES,
		type Task,
		type TaskPriority,
		type TaskStatus
	} from '$lib/stores/tasks';
	import { tree, loadTree, openTab, type VaultEntry } from '$lib/stores/vault';

	const REMIND_QUICK = [
		{ label: '15m before due', ms: 15 * 60000 },
		{ label: '1h before due', ms: 60 * 60000 },
		{ label: '1d before due', ms: 24 * 60 * 60000 }
	];

	// Width persists across sessions; drag the left edge to resize.
	const DRAWER_DEFAULT = 480;
	const DRAWER_MIN = 320;
	const DRAWER_MAX = 760;
	const WIDTH_KEY = 'scrinium:drawerWidth';
	function loadWidth(): number {
		if (typeof window === 'undefined') return DRAWER_DEFAULT;
		const v = Number(localStorage.getItem(WIDTH_KEY));
		return v >= DRAWER_MIN && v <= DRAWER_MAX ? v : DRAWER_DEFAULT;
	}
	let dw = $state(loadWidth());

	function gripDown(e: PointerEvent) {
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		try {
			el.setPointerCapture(e.pointerId);
		} catch {}
		const x0 = e.clientX;
		const w0 = dw;
		const move = (ev: PointerEvent) => {
			dw = Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, Math.round(w0 + (x0 - ev.clientX))));
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
			try {
				localStorage.setItem(WIDTH_KEY, String(dw));
			} catch {}
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	}

	function gripReset() {
		dw = DRAWER_DEFAULT;
		try {
			localStorage.setItem(WIDTH_KEY, String(dw));
		} catch {}
	}

	const task = $derived($tasks.find((t) => t.id === $openTaskId) ?? null);
	const parent = $derived(task?.parent_id ? ($tasks.find((t) => t.id === task.parent_id) ?? null) : null);
	const kids = $derived(task ? childrenOf($tasks, task.id) : []);
	const doneKids = $derived(kids.filter((k) => k.status === 'done').length);

	// Drafts reset whenever a different task opens.
	let titleDraft = $state('');
	let detailDraft = $state('');
	let syncedId: string | null = null;
	let links = $state<string[]>([]);
	$effect(() => {
		if (task && task.id !== syncedId) {
			syncedId = task.id;
			titleDraft = task.title;
			detailDraft = task.detail;
			linkQuery = '';
			subDraft = '';
			links = [];
			const id = task.id;
			void loadTaskLinks(id).then((r) => {
				if (get(openTaskId) === id) links = r;
			});
		}
		if (!task) {
			syncedId = null;
			links = [];
		}
	});

	let subDraft = $state('');
	let addingSub = $state(false);
	let linkQuery = $state('');

	$effect(() => {
		if ($openTaskId) {
			void loadTree();
			const key = (e: KeyboardEvent) => {
				if (e.key === 'Escape') closeTask();
			};
			window.addEventListener('keydown', key);
			return () => window.removeEventListener('keydown', key);
		}
	});

	function flatNotes(entries: VaultEntry[]): string[] {
		const out: string[] = [];
		const walk = (list: VaultEntry[]) => {
			for (const e of list) {
				if (e.type === 'file' && e.path.endsWith('.md')) out.push(e.path);
				else if (e.children) walk(e.children);
			}
		};
		walk(entries);
		return out.sort();
	}

	const noteMatches = $derived.by(() => {
		const q = linkQuery.trim().toLowerCase();
		const all = flatNotes($tree).filter((p) => !links.includes(p));
		if (!q) return all.slice(0, 6);
		return all.filter((p) => p.toLowerCase().includes(q)).slice(0, 6);
	});

	async function attachLink(t: Task, p: string) {
		links = await addTaskLink(t.id, p);
		linkQuery = '';
	}

	async function detachLink(t: Task, p: string) {
		links = await removeTaskLink(t.id, p);
	}

	function shortId(id: string): string {
		return `TASK-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
	}

	function stamp(ts: number): string {
		try {
			return new Date(ts).toLocaleString([], {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			});
		} catch {
			return '';
		}
	}

	function saveTitle(t: Task) {
		const v = titleDraft.trim();
		if (v && v !== t.title) void updateTask(t.id, { title: v.slice(0, 200) });
		else titleDraft = t.title;
	}

	function saveDetail(t: Task) {
		if (detailDraft !== t.detail) void updateTask(t.id, { detail: detailDraft.slice(0, 4000) });
	}

	async function addSub(t: Task) {
		const title = subDraft.trim().slice(0, 200);
		if (!title || addingSub) return;
		addingSub = true;
		try {
			const row = await createTask({ title, parent_id: t.id });
			if (row) subDraft = '';
		} finally {
			addingSub = false;
		}
	}

	function toggleSub(s: Task) {
		void updateTask(s.id, { status: s.status === 'done' ? 'todo' : 'done' });
	}

	function openNote(path: string) {
		openTab(path);
		closeTask();
		void goto('/');
	}

	async function handleDelete(t: Task) {
		if (!confirm(`Delete "${t.title}" and its subtasks?`)) return;
		await deleteTask(t.id);
	}

	const STATUS_ORDER: { key: TaskStatus; label: string }[] = [
		{ key: 'todo', label: 'Todo' },
		{ key: 'doing', label: 'Doing' },
		{ key: 'done', label: 'Done' }
	];
</script>

{#if task}
	<aside class="drawer" style="width: min({dw}px, 100vw)" aria-label="Task details">
		<div
			class="grip"
			title="Drag to resize (double-click to reset)"
			onpointerdown={gripDown}
			ondblclick={gripReset}
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize panel"
		></div>
		<header class="dhead">
			<span class="tid">{shortId(task.id)}</span>
			<span class="created">Created {stamp(task.created_at)}</span>
			<span class="sp"></span>
			<button class="icon" title="Delete task" onclick={() => void handleDelete(task)}>
				<span class="material-symbols-outlined">delete</span>
			</button>
			<button class="icon" title="Close (Esc)" onclick={closeTask}>
				<span class="material-symbols-outlined">close</span>
			</button>
		</header>

		{#if parent}
			<button class="up" onclick={() => openTask(parent.id)} title="Open parent task">
				<span class="material-symbols-outlined mini">arrow_upward</span>
				<span class="up-label">{parent.title}</span>
			</button>
		{/if}

		<input
			class="title"
			bind:value={titleDraft}
			aria-label="Task title"
			onchange={() => saveTitle(task)}
		/>

		<div class="fields">
			<div class="field">
				<span class="flabel">Status</span>
				<div class="seg" role="group" aria-label="Status">
					{#each STATUS_ORDER as s (s.key)}
						<button
							class="seg-btn"
							class:on={task.status === s.key}
							onclick={() => void updateTask(task.id, { status: s.key })}
						>
							{s.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="field">
				<span class="flabel">Priority</span>
				<select
					class="ctl pri-{task.priority}"
					value={task.priority}
					aria-label="Priority"
					onchange={(e) =>
						void updateTask(task.id, {
							priority: (e.target as HTMLSelectElement).value as TaskPriority
						})}
				>
					{#each PRIORITIES as p (p.key)}
						<option value={p.key}>{p.label}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<span class="flabel">Due date</span>
				<div class="due-row">
					<input
						class="ctl"
						type="date"
						value={dueInputValue(task.due_at)}
						aria-label="Due date"
						onchange={(e) =>
							void updateTask(task.id, {
								due_at: combineDateTime(
									(e.target as HTMLInputElement).value,
									dueTimeValue(task.due_at)
								)
							})}
					/>
					<input
						class="ctl time"
						type="time"
						value={dueTimeValue(task.due_at)}
						aria-label="Due time"
						disabled={task.due_at == null}
						title={task.due_at == null ? 'Set a date first' : 'Due time'}
						onchange={(e) =>
							void updateTask(task.id, {
								due_at: combineDateTime(
									dueInputValue(task.due_at),
									(e.target as HTMLInputElement).value
								)
							})}
					/>
					{#if task.due_at != null}
						<button
							class="icon"
							title="Clear due date"
							onclick={() => void updateTask(task.id, { due_at: null })}
						>
							<span class="material-symbols-outlined">backspace</span>
						</button>
					{/if}
				</div>
			</div>
			<div class="field">
				<span class="flabel">Reminder</span>
				<div class="due-row">
					<input
						class="ctl remind-in"
						type="datetime-local"
						value={dateTimeInputValue(task.remind_at)}
						aria-label="Reminder date and time"
						onchange={(e) =>
							void updateTask(task.id, {
								remind_at: parseDateTimeInput((e.target as HTMLInputElement).value)
							})}
					/>
					{#if task.remind_at != null}
						<button
							class="icon"
							title="Clear reminder"
							onclick={() => void updateTask(task.id, { remind_at: null })}
						>
							<span class="material-symbols-outlined">backspace</span>
						</button>
					{/if}
				</div>
			</div>
			{#if task.due_at != null}
				<div class="field">
					<span class="flabel"></span>
					<div class="quick">
						{#each REMIND_QUICK as q (q.label)}
							<button
								class="q-btn"
								onclick={() => void updateTask(task.id, { remind_at: task.due_at! - q.ms })}
							>
								{q.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<section class="block">
			<div class="bhead">
				<span class="blabel">Linked notes</span>
				<span class="bcount">
					{links.length === 0 ? 'none yet' : links.length === 1 ? '1 note' : `${links.length} notes`}
				</span>
			</div>
			{#if links.length > 0}
				<ul class="linked-list">
					{#each links as p (p)}
						<li class="artifact">
							<span class="material-symbols-outlined a-icon">description</span>
							<div class="a-main">
								<span class="a-name">{p.split('/').pop()}</span>
								<span class="a-path">/{p}</span>
							</div>
							<button class="icon" title="Open note" onclick={() => openNote(p)}>
								<span class="material-symbols-outlined">arrow_outward</span>
							</button>
							<button class="icon" title="Unlink note" onclick={() => void detachLink(task, p)}>
								<span class="material-symbols-outlined">link_off</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<input
				class="ctl pick-search"
				placeholder={links.length === 0
					? 'Search vault notes to link'
					: 'Link another note'}
				bind:value={linkQuery}
				aria-label="Search notes to link"
			/>
			{#if linkQuery.trim() !== '' || links.length === 0}
				{#if noteMatches.length === 0}
					<p class="pick-empty">No notes match.</p>
				{:else}
					<ul class="pick-list">
						{#each noteMatches as p (p)}
							<li>
								<button class="pick-row" onclick={() => void attachLink(task, p)}>
									<span class="material-symbols-outlined mini">description</span>
									<span class="pick-name">{p.split('/').pop()}</span>
									<span class="pick-path">/{p}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>

		<section class="block">
			<div class="bhead">
				<span class="blabel">Subtasks</span>
				<span class="bcount">
					{kids.length === 0 ? 'none yet' : `${doneKids} of ${kids.length} done`}
				</span>
			</div>
			{#if kids.length > 0}
				<ul class="subs">
					{#each kids as s (s.id)}
						<li class="sub" class:done={s.status === 'done'}>
							<button
								class="sub-check"
								title="Toggle done"
								onclick={() => toggleSub(s)}
								aria-label="Toggle subtask done"
							>
								<span class="material-symbols-outlined">
									{s.status === 'done' ? 'check_box' : 'check_box_outline_blank'}
								</span>
							</button>
							<button class="sub-title" onclick={() => openTask(s.id)} title="Open subtask">
								{s.title}
							</button>
							<button
								class="icon del"
								title="Delete subtask"
								onclick={() => void deleteTask(s.id)}
							>
								<span class="material-symbols-outlined">close</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="sub-add">
				<span class="material-symbols-outlined mini">add</span>
				<input
					class="sub-in"
					placeholder="Add subtask, Enter to save"
					bind:value={subDraft}
					aria-label="New subtask title"
					onkeydown={(e) => {
						if (e.key === 'Enter') void addSub(task);
					}}
				/>
			</div>
		</section>

		<section class="block">
			<div class="bhead">
				<span class="blabel">Notes</span>
			</div>
			<textarea
				class="detail"
				rows="5"
				placeholder="Details, context, links..."
				bind:value={detailDraft}
				aria-label="Task notes"
				onchange={() => saveDetail(task)}
			></textarea>
		</section>

		<footer class="dfoot">
			<span>Updated {stamp(task.updated_at)}</span>
		</footer>
	</aside>
{/if}

<style>
	.drawer {
		position: fixed;
		top: 48px;
		right: 0;
		bottom: 0;
		background: var(--surface-container-lowest);
		border-left: 1px solid var(--border-default);
		box-shadow: -12px 0 32px rgba(0, 0, 0, 0.35);
		z-index: 40;
		overflow-y: auto;
		padding: 14px 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		animation: slide-in 0.14s ease;
	}
	.grip {
		position: absolute;
		left: -4px;
		top: 0;
		bottom: 0;
		width: 9px;
		cursor: ew-resize;
		touch-action: none;
	}
	.grip:hover,
	.grip:active {
		background: color-mix(in srgb, var(--primary) 35%, transparent);
	}
	@keyframes slide-in {
		from {
			transform: translateX(24px);
			opacity: 0.4;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}

	.dhead {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.tid {
		font-size: var(--font-ui-micro);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface-variant);
		font-variant-numeric: tabular-nums;
	}
	.created {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
	}
	.sp {
		flex: 1;
	}
	.icon {
		width: 26px;
		height: 26px;
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
	.icon .material-symbols-outlined {
		font-size: 17px;
	}
	.icon:hover {
		background: var(--surface-container-high);
		color: var(--on-surface);
	}
	.icon.del:hover {
		color: var(--error);
	}
	.mini {
		font-size: 15px;
	}

	.up {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: var(--outline);
		font-size: var(--font-ui-micro);
		cursor: pointer;
		padding: 0;
		text-align: left;
	}
	.up:hover {
		color: var(--primary);
	}
	.up-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title {
		background: none;
		border: none;
		outline: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-large);
		font-weight: var(--font-ui-large-weight);
		line-height: 1.35;
		padding: 0;
		width: 100%;
		border-radius: 2px;
	}
	.title:focus-visible {
		outline: 1px solid var(--primary);
		outline-offset: 3px;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 10px 12px;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.flabel {
		width: 74px;
		flex-shrink: 0;
		font-size: var(--font-ui-micro);
		color: var(--outline);
	}
	.ctl {
		flex: 1;
		min-width: 0;
		height: 30px;
		padding: 0 8px;
		background: var(--surface-container-lowest);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		outline: none;
	}
	.ctl:focus {
		border-color: var(--primary);
	}
	.due-row {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.due-row .ctl {
		color-scheme: dark;
	}
	.due-row .time {
		flex: 0 0 96px;
	}
	.due-row .remind-in {
		flex: 1;
	}
	.quick {
		flex: 1;
		display: flex;
		gap: 6px;
	}
	.q-btn {
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--outline);
		font-family: var(--font-ui);
		font-size: var(--font-ui-micro);
		padding: 3px 10px;
		cursor: pointer;
	}
	.q-btn:hover {
		color: var(--primary);
		border-color: var(--primary);
	}
	.seg {
		flex: 1;
		display: flex;
		background: var(--surface-container-lowest);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		padding: 2px;
		gap: 2px;
	}
	.seg-btn {
		flex: 1;
		height: 25px;
		border: none;
		background: none;
		border-radius: calc(var(--radius) - 2px);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
	}
	.seg-btn:hover {
		background: var(--surface-container-high);
	}
	.seg-btn.on {
		background: var(--surface-container-highest);
		color: var(--on-surface);
		font-weight: var(--font-ui-medium-weight);
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

	.block {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.bhead {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.blabel {
		font-size: var(--font-label-caps);
		line-height: var(--font-label-caps-lh);
		font-weight: var(--font-label-caps-weight);
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--outline);
	}
	.bcount {
		margin-left: auto;
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		font-variant-numeric: tabular-nums;
	}

	.linked-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.artifact {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 9px 8px 9px 12px;
	}
	.a-icon {
		font-size: 20px;
		color: var(--outline);
		flex-shrink: 0;
	}
	.a-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.a-name {
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.a-path {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.pick-search {
		width: 100%;
	}
	.pick-empty {
		margin: 0;
		font-size: var(--font-ui-small);
		color: var(--outline-variant);
	}
	.pick-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 220px;
		overflow-y: auto;
	}
	.pick-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		background: none;
		border: none;
		border-radius: var(--radius);
		padding: 6px 8px;
		cursor: pointer;
		text-align: left;
		color: var(--on-surface-variant);
	}
	.pick-row:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.pick-name {
		font-size: var(--font-ui-small);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pick-path {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.subs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: var(--radius);
		padding: 2px 0;
	}
	.sub:hover {
		background: var(--surface-container-low);
	}
	.sub-check {
		background: none;
		border: none;
		color: var(--on-surface-variant);
		cursor: pointer;
		padding: 4px;
		display: flex;
		border-radius: var(--radius);
	}
	.sub-check .material-symbols-outlined {
		font-size: 18px;
	}
	.sub-check:hover {
		color: var(--primary);
	}
	.sub-title {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		text-align: left;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
		padding: 4px 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub-title:hover {
		color: var(--primary);
	}
	.sub.done .sub-title {
		text-decoration: line-through;
		color: var(--outline);
	}
	.sub-add {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--outline-variant);
		padding: 2px 0;
	}
	.sub-in {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		outline: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		height: 28px;
	}
	.sub-in::placeholder {
		color: var(--outline-variant);
	}

	.detail {
		width: 100%;
		resize: vertical;
		min-height: 96px;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		line-height: 1.55;
		padding: 8px 10px;
		outline: none;
	}
	.detail:focus {
		border-color: var(--primary);
	}
	.detail::placeholder {
		color: var(--outline-variant);
	}

	.dfoot {
		margin-top: auto;
		padding-top: 8px;
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		font-variant-numeric: tabular-nums;
	}

	button:focus-visible,
	input:focus-visible,
	select:focus-visible,
	textarea:focus-visible {
		outline: 1px solid var(--primary);
		outline-offset: 1px;
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer {
			animation: none;
		}
	}
</style>
