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
		STATUSES,
		AREAS,
		type Task,
		type TaskPriority
	} from '$lib/stores/tasks';
	import { tree, loadTree, openTab, type VaultEntry } from '$lib/stores/vault';

	const REMIND_QUICK = [
		{ label: '15m before due', ms: 15 * 60000 },
		{ label: '1h before due', ms: 60 * 60000 },
		{ label: '1d before due', ms: 24 * 60 * 60000 }
	];

	// Width persists across sessions; drag the left edge to resize.
	const DRAWER_DEFAULT = 400;
	const DRAWER_MIN = 340;
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

	// Short labels so all five statuses fit one segmented row.
	const STATUS_SHORT: Record<string, string> = { todo: 'Week' };

	let waitingDraft = $state('');
	$effect(() => {
		waitingDraft = task?.waiting_on ?? '';
	});

	function saveWaiting(t: Task) {
		const v = waitingDraft.trim() || null;
		if (v !== t.waiting_on) void updateTask(t.id, { waiting_on: v });
	}

	function since(ts: number | null): string {
		if (ts == null) return '';
		const days = Math.floor((Date.now() - ts) / 86400000);
		return days <= 0 ? 'since today' : days === 1 ? 'for 1 day' : `for ${days} days`;
	}
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
			<span class="material-symbols-outlined">task_alt</span>
			<span class="tid">{shortId(task.id)}</span>
			<span>created {stamp(task.created_at)}</span>
			<span class="sp"></span>
			<button class="icon" title="Delete task" onclick={() => void handleDelete(task)}>
				<span class="material-symbols-outlined">delete</span>
			</button>
			<button class="icon" title="Close (Esc)" onclick={closeTask}>
				<span class="material-symbols-outlined">close</span>
			</button>
		</header>

		<div class="body">
			{#if parent}
				<button class="up" onclick={() => openTask(parent.id)} title="Open parent task">
					<span class="material-symbols-outlined">subdirectory_arrow_left</span>
					<span class="up-label">{parent.title}</span>
				</button>
			{/if}

			<textarea
				class="title"
				rows="1"
				bind:value={titleDraft}
				aria-label="Task title"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						(e.currentTarget as HTMLTextAreaElement).blur();
					}
				}}
				onchange={() => saveTitle(task)}
			></textarea>

			<div class="kv">
				<span class="k">Status</span>
				<div class="seg" role="group" aria-label="Status">
					{#each STATUSES as st (st.key)}
						<button
							class:on={task.status === st.key}
							title={st.label}
							onclick={() => void updateTask(task.id, { status: st.key })}
						>
							{STATUS_SHORT[st.key] ?? st.label}
						</button>
					{/each}
				</div>
			</div>
			{#if task.status === 'waiting'}
				<div class="kv">
					<span class="k">Waiting on</span>
					<div class="v">
						<input
							class="ctl grow"
							placeholder="Who or what"
							bind:value={waitingDraft}
							onchange={() => saveWaiting(task)}
						/>
						<span class="muted">{since(task.waiting_since)}</span>
					</div>
				</div>
			{/if}
			<div class="kv">
				<span class="k">Area</span>
				<div class="chips" role="group" aria-label="Area">
					{#each AREAS as a (a.key)}
						<button
							class="chip"
							class:on={task.area === a.key}
							style="--c: {a.color}"
							onclick={() => void updateTask(task.id, { area: task.area === a.key ? null : a.key })}
						>
							<i></i>{a.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="kv">
				<span class="k">Priority</span>
				<div class="v">
					<span class="material-symbols-outlined fill flag pri-{task.priority}">flag</span>
					<select
						class="ctl bare"
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
			</div>
			<div class="kv">
				<span class="k">Due</span>
				<div class="v">
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
							<span class="material-symbols-outlined">close</span>
						</button>
					{/if}
				</div>
			</div>
			<div class="kv">
				<span class="k">Reminder</span>
				<div class="v">
					<input
						class="ctl"
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
							<span class="material-symbols-outlined">close</span>
						</button>
					{/if}
				</div>
			</div>
			{#if task.due_at != null}
				<div class="kv">
					<span class="k"></span>
					<div class="v quick">
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

			<section class="block">
				<h4>Subtasks{#if kids.length > 0}<span class="n">{doneKids} of {kids.length}</span>{/if}</h4>
				{#if kids.length > 0}
					<div class="progress"><i style="width: {(doneKids / kids.length) * 100}%"></i></div>
					<ul class="subs">
						{#each kids as sub (sub.id)}
							<li class="sub" class:done={sub.status === 'done'}>
								<button
									class="sub-check"
									title="Toggle done"
									onclick={() => toggleSub(sub)}
									aria-label="Toggle subtask done"
								>
									<span class="material-symbols-outlined" class:fill={sub.status === 'done'}>
										{sub.status === 'done' ? 'check_circle' : 'radio_button_unchecked'}
									</span>
								</button>
								<button class="sub-title" onclick={() => openTask(sub.id)} title="Open subtask">
									{sub.title}
								</button>
								<button class="icon del" title="Delete subtask" onclick={() => void deleteTask(sub.id)}>
									<span class="material-symbols-outlined">close</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="sub-add">
					<span class="material-symbols-outlined">add</span>
					<input
						class="sub-in"
						placeholder="Add subtask"
						bind:value={subDraft}
						aria-label="New subtask title"
						onkeydown={(e) => {
							if (e.key === 'Enter') void addSub(task);
						}}
					/>
				</div>
			</section>

			<section class="block">
				<h4>Linked notes{#if links.length > 0}<span class="n">{links.length}</span>{/if}</h4>
				{#each links as p (p)}
					<div class="note">
						<button class="note-open" onclick={() => openNote(p)} title="Open note">
							<span class="material-symbols-outlined">description</span>
							<span class="note-name">{(p.split('/').pop() ?? p).replace(/\.md$/, '')}</span>
							<span class="note-path">{p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''}</span>
						</button>
						<button class="icon" title="Unlink note" onclick={() => void detachLink(task, p)}>
							<span class="material-symbols-outlined">link_off</span>
						</button>
					</div>
				{/each}
				<input
					class="ctl pick-search"
					placeholder={links.length === 0 ? 'Search notes to link' : 'Link another note'}
					bind:value={linkQuery}
					aria-label="Search notes to link"
				/>
				{#if linkQuery.trim() !== ''}
					{#if noteMatches.length === 0}
						<p class="muted pick-empty">No notes match.</p>
					{:else}
						<ul class="pick-list">
							{#each noteMatches as p (p)}
								<li>
									<button class="pick-row" onclick={() => void attachLink(task, p)}>
										<span class="material-symbols-outlined">add_link</span>
										<span class="pick-name">{(p.split('/').pop() ?? p).replace(/\.md$/, '')}</span>
										<span class="pick-path">{p}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</section>

			<section class="block">
				<h4>Notes</h4>
				<textarea
					class="detail"
					rows="5"
					placeholder="Details, context, links"
					bind:value={detailDraft}
					aria-label="Task notes"
					onchange={() => saveDetail(task)}
				></textarea>
			</section>
		</div>

		<footer class="dfoot">Updated {stamp(task.updated_at)}</footer>
	</aside>
{/if}

<style>
	.drawer {
		position: relative;
		flex-shrink: 0;
		height: 100vh;
		background: var(--panel);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
	}
	.grip {
		position: absolute;
		left: -4px;
		top: 0;
		bottom: 0;
		width: 8px;
		cursor: ew-resize;
		touch-action: none;
		z-index: 2;
	}
	.grip:hover,
	.grip:active {
		background: var(--accent-dim);
	}
	.dhead {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 48px;
		padding: 0 8px 0 18px;
		border-bottom: 1px solid var(--line);
		color: var(--text-3);
		font-size: var(--fs-xs);
		flex-shrink: 0;
	}
	.dhead > .material-symbols-outlined {
		font-size: 16px;
	}
	.tid {
		font-variant-numeric: tabular-nums;
	}
	.sp {
		flex: 1;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 16px 18px 24px;
	}
	.icon {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: none;
		background: none;
		color: var(--text-3);
		border-radius: var(--r);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}
	.icon .material-symbols-outlined {
		font-size: 17px;
	}
	.icon:hover {
		background: var(--hover);
		color: var(--text);
	}
	.up {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		margin-bottom: 8px;
		padding: 2px 8px 2px 4px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-3);
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.up:hover {
		background: var(--hover);
		color: var(--text);
	}
	.up .material-symbols-outlined {
		font-size: 16px;
	}
	.up-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title {
		width: 100%;
		margin: 0 0 14px;
		padding: 2px 0;
		border: none;
		outline: none;
		resize: none;
		field-sizing: content;
		background: none;
		color: var(--text);
		font: 700 21px / 1.35 var(--font-read);
	}
	.kv {
		display: grid;
		grid-template-columns: 92px minmax(0, 1fr);
		align-items: center;
		min-height: 38px;
	}
	.k {
		color: var(--text-3);
		font-size: var(--fs);
	}
	.v {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.muted {
		color: var(--text-3);
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.seg {
		display: flex;
		background: var(--raise);
		border-radius: var(--r-md);
		padding: 2px;
		gap: 2px;
		min-width: 0;
	}
	.seg button {
		flex: 1;
		min-width: 0;
		height: 26px;
		padding: 0 6px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		font: var(--fs-sm) var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
	}
	.seg button:hover {
		color: var(--text);
	}
	.seg button.on {
		background: var(--press);
		color: var(--text);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 9px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs-sm) var(--font-ui);
		cursor: pointer;
	}
	.chip i {
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: var(--c);
	}
	.chip:hover {
		color: var(--text);
		border-color: var(--line-3);
	}
	.chip.on {
		color: var(--text);
		border-color: color-mix(in srgb, var(--c) 55%, transparent);
		background: color-mix(in srgb, var(--c) 12%, transparent);
	}
	.flag {
		font-size: 17px;
		color: var(--text-4);
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
	.ctl {
		height: 30px;
		min-width: 0;
		padding: 0 8px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: var(--bg);
		color: var(--text);
		font: var(--fs) var(--font-ui);
		color-scheme: dark;
		outline: none;
	}
	.ctl:focus {
		border-color: var(--accent);
	}
	.ctl:disabled {
		opacity: 0.4;
	}
	.ctl.grow {
		flex: 1;
	}
	.ctl.time {
		width: 104px;
	}
	.ctl.bare {
		border-color: transparent;
		background: none;
		padding: 0 4px;
		cursor: pointer;
	}
	.ctl.bare:hover {
		background: var(--hover);
	}
	.quick {
		flex-wrap: wrap;
		padding-bottom: 4px;
	}
	.q-btn {
		height: 24px;
		padding: 0 8px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-2);
		font: var(--fs-xs) var(--font-ui);
		cursor: pointer;
	}
	.q-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.block {
		margin-top: 22px;
	}
	h4 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	h4 .n {
		color: var(--text-3);
		font-weight: 400;
	}
	.progress {
		height: 4px;
		margin: 0 0 8px;
		background: var(--raise);
		border-radius: 2px;
		overflow: hidden;
	}
	.progress i {
		display: block;
		height: 100%;
		background: var(--green);
		border-radius: 2px;
		transition: width 0.2s ease;
	}
	.subs {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding: 0 2px 0 4px;
		border-radius: var(--r);
	}
	.sub:hover {
		background: var(--hover);
	}
	.sub-check {
		display: grid;
		place-items: center;
		border: none;
		background: none;
		padding: 0;
		color: var(--text-3);
		cursor: pointer;
	}
	.sub-check:hover {
		color: var(--accent);
	}
	.sub.done .sub-check {
		color: var(--green);
	}
	.sub-title {
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
	.sub.done .sub-title {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.del {
		visibility: hidden;
	}
	.sub:hover .del {
		visibility: visible;
	}
	.sub-add {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding: 0 4px;
		color: var(--text-3);
	}
	.sub-in {
		flex: 1;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: var(--fs) var(--font-ui);
	}
	.sub-in::placeholder {
		color: var(--text-3);
	}
	.note {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 6px;
		padding-right: 4px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--raise);
	}
	.note-open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 10px;
		border: none;
		background: none;
		color: var(--text);
		font: 500 var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.note-open .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.note-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.note-path {
		margin-left: auto;
		color: var(--text-3);
		font-size: var(--fs-xs);
		font-weight: 400;
		white-space: nowrap;
	}
	.pick-search {
		width: 100%;
	}
	.pick-empty {
		margin: 6px 2px;
	}
	.pick-list {
		list-style: none;
		margin: 4px 0 0;
		padding: 4px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-md);
		background: var(--bg);
	}
	.pick-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 30px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.pick-row:hover {
		background: var(--hover);
		color: var(--text);
	}
	.pick-row .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.pick-name {
		white-space: nowrap;
	}
	.pick-path {
		margin-left: auto;
		color: var(--text-3);
		font-size: var(--fs-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detail {
		width: 100%;
		min-height: 110px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--bg);
		color: var(--text);
		font: var(--fs-md) / 1.65 var(--font-read);
		resize: vertical;
		outline: none;
	}
	.detail:focus {
		border-color: var(--accent);
	}
	.dfoot {
		height: 26px;
		display: flex;
		align-items: center;
		padding: 0 18px;
		border-top: 1px solid var(--line);
		color: var(--text-3);
		font-size: var(--fs-xs);
		flex-shrink: 0;
	}
</style>
