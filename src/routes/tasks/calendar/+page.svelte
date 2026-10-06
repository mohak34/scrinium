<script lang="ts">
	import { onMount } from 'svelte';
	import {
		tasks,
		loadTasks,
		createTask,
		updateTask,
		openTask,
		openTaskId,
		topLevel,
		isOverdue,
		dueTimeValue,
		type Task
	} from '$lib/stores/tasks';
	import { areaMeta } from '$lib/taskModel';
	import { connectCalendar } from '$lib/auth-client';
	import { eventOnDay, eventStart, type CalendarEvent } from '$lib/calendar';
	import AppSwitcher from '$lib/components/AppSwitcher.svelte';
	import PageFooter from '$lib/components/PageFooter.svelte';

	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	const today = new Date();
	let viewYear = $state(today.getFullYear());
	let viewMonth = $state(today.getMonth());
	let selected = $state(dayKey(today.getFullYear(), today.getMonth(), today.getDate()));
	let gev = $state<CalendarEvent[]>([]);
	let calendarState = $state<'loading' | 'connected' | 'disconnected' | 'error'>('loading');
	// Bumped on focus and on a timer so events added elsewhere (phone, an
	// agent) show up without a reload.
	let refresh = $state(0);
	let connectFailed = $state(false);
	let shownMonth = '';

	// Google overlay for the visible grid. Local tasks render regardless. A
	// refresh keeps the old events on screen until the new ones arrive; a
	// month change clears them so last month's events never sit on this grid.
	$effect(() => {
		const [from, to] = gridRange(viewYear, viewMonth);
		void refresh;
		const month = `${viewYear}-${viewMonth}`;
		if (month !== shownMonth) {
			shownMonth = month;
			gev = [];
			calendarState = 'loading';
		}
		const ctl = new AbortController();
		(async () => {
			try {
				const res = await fetch(`/api/calendar/events?from=${from}&to=${to}`, {
					cache: 'no-store',
					signal: ctl.signal
				});
				if (!res.ok) throw new Error(`calendar ${res.status}`);
				const data = (await res.json()) as { events: CalendarEvent[]; needsConnect?: boolean };
				if (ctl.signal.aborted) return;
				gev = data.events;
				calendarState = data.needsConnect ? 'disconnected' : 'connected';
			} catch {
				if (!ctl.signal.aborted) calendarState = 'error';
			}
		})();
		return () => ctl.abort();
	});

	async function connect() {
		connectFailed = false;
		try {
			await connectCalendar();
		} catch {
			connectFailed = true;
		}
	}

	const calendarNote = $derived(
		connectFailed
			? 'Google Calendar connection failed'
			: {
					loading: 'Loading Google Calendar',
					connected: 'Google Calendar connected',
					disconnected: 'Google Calendar not connected',
					error: 'Google Calendar unavailable'
				}[calendarState]
	);

	function gridRange(y: number, m: number): [number, number] {
		const first = new Date(y, m, 1);
		const lead = (first.getDay() + 6) % 7;
		const from = new Date(y, m, 1 - lead).getTime();
		const to = new Date(y, m, 1 - lead + 42).getTime();
		return [from, to];
	}

	function fmtTime(ts: number | string): string {
		try {
			return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	onMount(() => {
		void loadTasks();
		connectFailed = new URLSearchParams(location.search).has('calendarError');
		const again = () => {
			if (document.visibilityState !== 'visible') return;
			const n = new Date();
			todayKey = dayKey(n.getFullYear(), n.getMonth(), n.getDate());
			refresh++;
		};
		window.addEventListener('focus', again);
		document.addEventListener('visibilitychange', again);
		const timer = setInterval(again, 5 * 60000);
		return () => {
			window.removeEventListener('focus', again);
			document.removeEventListener('visibilitychange', again);
			clearInterval(timer);
		};
	});

	function dayKey(y: number, m: number, d: number): string {
		return `${y}-${m}-${d}`;
	}

	function keyOf(ts: number): string {
		const d = new Date(ts);
		return dayKey(d.getFullYear(), d.getMonth(), d.getDate());
	}

	interface Cell {
		y: number;
		m: number;
		d: number;
		inMonth: boolean;
		key: string;
	}

	const cells = $derived.by((): Cell[] => {
		// Monday-first grid covering the view month.
		const first = new Date(viewYear, viewMonth, 1);
		const lead = (first.getDay() + 6) % 7;
		const out: Cell[] = [];
		for (let i = 0; i < 42; i++) {
			const dt = new Date(viewYear, viewMonth, 1 - lead + i);
			const y = dt.getFullYear();
			const m = dt.getMonth();
			const d = dt.getDate();
			out.push({ y, m, d, inMonth: m === viewMonth, key: dayKey(y, m, d) });
		}
		// Drop a fully out-of-month trailing week.
		if (cellsTrim(out)) return out.slice(0, 35);
		return out;
	});

	function cellsTrim(out: Cell[]): boolean {
		return out.slice(35).every((c) => !c.inMonth);
	}

	const byDay = $derived.by(() => {
		const map = new Map<string, Task[]>();
		for (const t of topLevel($tasks)) {
			if (t.due_at == null) continue;
			const k = keyOf(t.due_at);
			if (!map.has(k)) map.set(k, []);
			map.get(k)!.push(t);
		}
		for (const list of map.values()) {
			list.sort((a, b) => (a.due_at ?? 0) - (b.due_at ?? 0));
		}
		return map;
	});

	const unscheduled = $derived(
		topLevel($tasks).filter((t) => t.due_at == null && t.status !== 'done').length
	);

	const selectedTasks = $derived.by(() => {
		const list = byDay.get(selected) ?? [];
		return [...list].sort((a, b) => (a.due_at ?? 0) - (b.due_at ?? 0));
	});

	// Multi-day events show on every day they cover.
	const eventsByDay = $derived.by(() => {
		const sorted = [...gev].sort((a, b) => eventStart(a) - eventStart(b));
		const map = new Map<string, CalendarEvent[]>();
		for (const c of cells) {
			const day = new Date(c.y, c.m, c.d);
			const list = sorted.filter((e) => eventOnDay(e, day));
			if (list.length) map.set(c.key, list);
		}
		return map;
	});

	const selectedEvents = $derived(eventsByDay.get(selected) ?? []);

	const selectedLabel = $derived.by(() => {
		const [y, m, d] = selected.split('-').map(Number);
		try {
			return new Date(y, m, d).toLocaleDateString([], {
				weekday: 'long',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return '';
		}
	});

	const monthLabel = $derived.by(() => {
		try {
			return new Date(viewYear, viewMonth, 1).toLocaleDateString([], {
				month: 'long',
				year: 'numeric'
			});
		} catch {
			return '';
		}
	});

	// Follows the clock so a tab left open overnight highlights the new day.
	let todayKey = $state(dayKey(today.getFullYear(), today.getMonth(), today.getDate()));

	function shiftMonth(dir: 1 | -1) {
		const d = new Date(viewYear, viewMonth + dir, 1);
		viewYear = d.getFullYear();
		viewMonth = d.getMonth();
		selected = dayKey(viewYear, viewMonth, 1);
	}

	function goToday() {
		const n = new Date();
		viewYear = n.getFullYear();
		viewMonth = n.getMonth();
		selected = dayKey(n.getFullYear(), n.getMonth(), n.getDate());
	}

	function statusIcon(t: Task): string {
		if (t.status === 'done') return 'check_circle';
		if (t.status === 'doing') return 'clock_loader_40';
		if (t.status === 'waiting') return 'hourglass_top';
		return 'radio_button_unchecked';
	}

	const undated = $derived(
		topLevel($tasks).filter((t) => t.due_at == null && t.status !== 'done')
	);

	function dayStart(key: string): number {
		const [y, m, d] = key.split('-').map(Number);
		return new Date(y, m, d).getTime();
	}

	// Drag a task onto a day to (re)schedule it; a set time of day survives.
	let dragId = $state<string | null>(null);
	let overDay = $state<string | null>(null);

	function dragStart(t: Task, e: DragEvent) {
		dragId = t.id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', t.id);
		}
	}

	async function dropOn(key: string, e: DragEvent) {
		e.preventDefault();
		const id = dragId ?? e.dataTransfer?.getData('text/plain');
		dragId = null;
		overDay = null;
		const t = id ? $tasks.find((x) => x.id === id) : null;
		if (!t) return;
		const base = new Date(dayStart(key));
		if (t.due_at != null) {
			const prev = new Date(t.due_at);
			base.setHours(prev.getHours(), prev.getMinutes());
		}
		selected = key;
		await updateTask(t.id, { due_at: base.getTime(), status: t.status === 'inbox' ? 'todo' : t.status });
	}

	let draft = $state('');
	async function addForDay() {
		const title = draft.trim();
		if (!title) return;
		draft = '';
		await createTask({ title, due_at: dayStart(selected), status: 'todo' });
	}

	const daySummary = $derived.by(() => {
		const parts = [];
		if (selectedEvents.length) parts.push(`${selectedEvents.length} ${selectedEvents.length === 1 ? 'event' : 'events'}`);
		if (selectedTasks.length) parts.push(`${selectedTasks.length} ${selectedTasks.length === 1 ? 'task' : 'tasks'}`);
		return parts.join(', ') || 'Nothing planned';
	});
</script>

<div class="page">
	<div class="main">
		<header class="page-h">
			<AppSwitcher current="calendar" size="lg" />
			<span class="vsep"></span>
			<span class="mo">{monthLabel}</span>
			<button class="ib" title="Previous month" onclick={() => shiftMonth(-1)} aria-label="Previous month">
				<span class="material-symbols-outlined">chevron_left</span>
			</button>
			<button class="ib" title="Next month" onclick={() => shiftMonth(1)} aria-label="Next month">
				<span class="material-symbols-outlined">chevron_right</span>
			</button>
			<button class="line" onclick={goToday}>Today</button>
			<span class="sp"></span>
			{#if calendarState === 'disconnected' || connectFailed}
				<button class="line" onclick={() => void connect()}>
					<span class="material-symbols-outlined">add_link</span>Connect Google Calendar
				</button>
			{/if}
		</header>

		<div class="grid" role="grid" aria-label="Task calendar" style="--weeks: {cells.length / 7}">
			{#each WEEKDAYS as w (w)}
				<div class="dow">{w}</div>
			{/each}
			{#each cells as c, i (c.key)}
				{@const list = byDay.get(c.key) ?? []}
				{@const evs = eventsByDay.get(c.key) ?? []}
				{@const shown = 3}
				<div
					class="day"
					class:out={!c.inMonth}
					class:wk={i % 7 >= 5}
					class:today={c.key === todayKey}
					class:sel={c.key === selected}
					class:drop={overDay === c.key}
					onclick={() => (selected = c.key)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') selected = c.key;
					}}
					ondragover={(e) => {
						e.preventDefault();
						overDay = c.key;
					}}
					ondragleave={() => {
						if (overDay === c.key) overDay = null;
					}}
					ondrop={(e) => void dropOn(c.key, e)}
					role="gridcell"
					tabindex="0"
					aria-label="{new Date(c.y, c.m, c.d).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}, {list.length} tasks, {evs.length} events"
				>
					<span class="dn">{c.d}</span>
					{#each evs.slice(0, shown) as e (e.id)}
						<span class="ev g" style:--ev={e.color} title="{e.title} ({e.calendar})">
							{#if !e.allDay && eventStart(e) >= dayStart(c.key)}<span class="tm">{fmtTime(e.start)}</span>{/if}{e.title}
						</span>
					{/each}
					{#each list.slice(0, Math.max(0, shown - evs.length)) as t (t.id)}
						<span
							class="ev task"
							class:over={isOverdue(t)}
							class:done={t.status === 'done'}
							title={t.title}
							draggable="true"
							ondragstart={(e) => dragStart(t, e)}
							ondragend={() => (dragId = null)}
							role="button"
							tabindex="-1"
							onclick={(e) => {
								e.stopPropagation();
								selected = c.key;
								openTask(t.id);
							}}
							onkeydown={() => {}}>{t.title}</span
						>
					{/each}
					{#if list.length + evs.length > shown}
						<span class="more">{list.length + evs.length - shown} more</span>
					{/if}
				</div>
			{/each}
		</div>
		<PageFooter>
			<span>{undated.length} without a date</span>
			<span>{calendarNote}</span>
		</PageFooter>
	</div>

	<aside class="agenda" aria-label="Selected day">
		<div class="ag-head">
			<div class="big">{selectedLabel}</div>
			<div class="sub">{daySummary}</div>
		</div>
		<div class="ag-scroll">
			{#each selectedEvents as e (e.id)}
				<div class="ag-row g" style:--ev={e.color} title="Google Calendar event, read only">
					<span class="tm">
						{e.allDay ? 'All day' : eventStart(e) >= dayStart(selected) ? fmtTime(e.start) : 'Continued'}
					</span>
					<div>
						<div class="tt">{e.title}</div>
						<div class="src"><span class="material-symbols-outlined">event</span>{e.calendar}</div>
					</div>
				</div>
			{/each}
			{#each selectedTasks as t (t.id)}
				<div
					class="ag-row t"
					class:done={t.status === 'done'}
					class:over={isOverdue(t)}
					class:on={$openTaskId === t.id}
					onclick={(e) => {
						if ((e.target as HTMLElement).closest('button')) return;
						openTask(t.id);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter' && e.target === e.currentTarget) openTask(t.id);
					}}
					role="button"
					tabindex="0"
					draggable="true"
					ondragstart={(e) => dragStart(t, e)}
					ondragend={() => (dragId = null)}
				>
					<span class="tm">{dueTimeValue(t.due_at) ? fmtTime(t.due_at!) : 'Any time'}</span>
					<div>
						<div class="tt">{t.title}</div>
						<div class="src">
							<button
								class="st"
								title="Mark done"
								onclick={() => void updateTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}
							>
								<span class="material-symbols-outlined" class:fill={t.status === 'done'}>{statusIcon(t)}</span>
							</button>
							{#if t.area}<i style="background: {areaMeta(t.area).color}"></i>{areaMeta(t.area).label}{/if}
							{#if t.priority !== 'none'}<span class="pri-{t.priority}">{t.priority}</span>{/if}
						</div>
					</div>
				</div>
			{/each}
			<div class="ag-add">
				<span class="material-symbols-outlined">add</span>
				<input
					placeholder="Add a task for this day"
					bind:value={draft}
					onkeydown={(e) => {
						if (e.key === 'Enter') void addForDay();
					}}
				/>
			</div>
			{#if undated.length > 0}
				<div class="ag-group">No date<span class="n">{undated.length}</span></div>
				<p class="hint">Drag one onto a day to schedule it.</p>
				{#each undated as t (t.id)}
					<div
						class="und"
						draggable="true"
						ondragstart={(e) => dragStart(t, e)}
						ondragend={() => (dragId = null)}
						onclick={() => openTask(t.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter') openTask(t.id);
						}}
						role="button"
						tabindex="0"
					>
						<span class="material-symbols-outlined">drag_indicator</span>
						<span class="und-t">{t.title}</span>
						{#if t.area}<i style="background: {areaMeta(t.area).color}"></i>{/if}
					</div>
				{/each}
			{/if}
		</div>
	</aside>
</div>

<style>
	.page {
		flex: 1;
		min-height: 0;
		display: flex;
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
		gap: 8px;
		height: 56px;
		padding: 0 16px 0 24px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}
	.vsep {
		width: 1px;
		height: 18px;
		background: var(--line-2);
		margin: 0 8px;
	}
	.mo {
		min-width: 150px;
		font: 700 18px var(--font-read);
		white-space: nowrap;
	}
	.sp {
		flex: 1;
	}
	.ib {
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
	.ib:hover {
		background: var(--hover);
		color: var(--text);
	}
	.line {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		margin-left: 6px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-md);
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
	}
	.line .material-symbols-outlined {
		font-size: 17px;
	}
	.line:hover {
		color: var(--text);
		border-color: var(--line-3);
	}
	.grid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		grid-template-rows: 34px repeat(var(--weeks), minmax(0, 1fr));
	}
	.dow {
		display: flex;
		align-items: center;
		padding: 0 12px;
		color: var(--text-3);
		font-size: var(--fs-sm);
		border-right: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
	.day {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-height: 0;
		padding: 8px 8px 6px;
		overflow: hidden;
		border-right: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		cursor: pointer;
		outline-offset: -2px;
	}
	.dow:nth-child(7n),
	.day:nth-child(7n) {
		border-right: 0;
	}
	.day.wk {
		background: #080808;
	}
	.day:hover {
		background: var(--raise);
	}
	.day.sel {
		background: var(--raise);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
	}
	.day.drop {
		background: var(--accent-dim);
	}
	.dn {
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		margin: -2px 0 2px -2px;
		border-radius: 50%;
		color: var(--text-2);
		font-size: var(--fs);
		font-variant-numeric: tabular-nums;
	}
	.day.out .dn {
		color: var(--text-4);
	}
	.day.today .dn {
		background: var(--accent-fill);
		color: var(--on-accent);
		font-weight: 600;
	}
	.ev {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 6px;
		border-radius: var(--r-sm);
		color: var(--text);
		font-size: var(--fs-xs);
		line-height: 20px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 0;
	}
	.ev.task::before {
		content: '';
		flex: none;
		width: 6px;
		height: 6px;
		border: 1.5px solid var(--text-2);
		border-radius: 2px;
	}
	.ev.task:hover {
		background: var(--hover);
	}
	.ev.task.over {
		color: var(--red);
	}
	.ev.task.over::before {
		border-color: var(--red);
	}
	.ev.task.done {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.ev.task.done::before {
		background: var(--text-3);
		border-color: var(--text-3);
	}
	.ev.g {
		background: color-mix(in srgb, var(--ev, var(--blue)) 13%, transparent);
		color: #c5d6ff;
		display: block;
	}
	.ev.g .tm {
		color: var(--ev, var(--blue));
		margin-right: 6px;
	}
	.more {
		padding-left: 6px;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.agenda {
		width: 320px;
		flex-shrink: 0;
		background: var(--panel);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
	}
	.ag-head {
		padding: 18px 18px 12px;
		border-bottom: 1px solid var(--line);
	}
	.big {
		font: 700 24px / 1.2 var(--font-read);
	}
	.ag-head .sub {
		margin-top: 4px;
		color: var(--text-3);
	}
	.ag-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 24px;
	}
	.ag-row {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr);
		gap: 10px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--line);
		align-items: start;
	}
	.ag-row.g {
		box-shadow: inset 2px 0 0 var(--ev, var(--blue));
	}
	.ag-row.t {
		box-shadow: inset 2px 0 0 var(--accent);
		cursor: pointer;
	}
	.ag-row.t:hover {
		background: var(--raise);
	}
	.ag-row.t.on {
		background: var(--accent-dim);
	}
	.ag-row.t.over {
		box-shadow: inset 2px 0 0 var(--red);
	}
	.ag-row .tm {
		padding-top: 2px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.tt {
		color: var(--text);
	}
	.ag-row.done .tt {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.src {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 3px;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.src .material-symbols-outlined {
		font-size: 15px;
	}
	.src i,
	.und i {
		width: 7px;
		height: 7px;
		border-radius: 2px;
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
	.ag-row.done .st {
		color: var(--green);
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
	.ag-add {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 42px;
		padding: 0 18px;
		color: var(--text-3);
		border-bottom: 1px solid var(--line);
	}
	.ag-add input {
		flex: 1;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: var(--fs) var(--font-ui);
	}
	.ag-add input::placeholder {
		color: var(--text-3);
	}
	.ag-group {
		display: flex;
		gap: 8px;
		padding: 18px 18px 2px;
		font-weight: 600;
		font-size: var(--fs-sm);
	}
	.ag-group .n {
		color: var(--text-3);
		font-weight: 400;
	}
	.hint {
		margin: 0;
		padding: 0 18px 8px;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.und {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 10px;
		padding: 6px 8px 6px 4px;
		border-radius: var(--r);
		color: var(--text-2);
		cursor: grab;
	}
	.und:hover {
		background: var(--raise);
		color: var(--text);
	}
	.und .material-symbols-outlined {
		font-size: 17px;
		color: var(--text-4);
	}
	.und-t {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
