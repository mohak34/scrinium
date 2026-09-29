<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		tasks,
		loadTasks,
		updateTask,
		openTask,
		topLevel,
		isOverdue,
		dueTimeValue,
		type Task
	} from '$lib/stores/tasks';
	import { connectCalendar } from '$lib/auth-client';

	// Google events as returned by GET /api/calendar/events (read-only).
	interface GEvent {
		id: string;
		title: string;
		start: number;
		end: number;
		allDay: boolean;
	}

	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	let today = new Date();
	let viewYear = $state(today.getFullYear());
	let viewMonth = $state(today.getMonth());
	let selected = $state(dayKey(today.getFullYear(), today.getMonth(), today.getDate()));
	let gev = $state<GEvent[]>([]);
	let needConnect = $state(false);

	// Google overlay for the visible grid. Local tasks render regardless;
	// a failed fetch just leaves the overlay empty.
	$effect(() => {
		const y = viewYear;
		const m = viewMonth;
		const [from, to] = gridRange(y, m);
		let dead = false;
		(async () => {
			try {
				const res = await fetch(`/api/calendar/events?from=${from}&to=${to}`, {
					credentials: 'include'
				});
				if (!res.ok || dead) return;
				const data = (await res.json()) as { events?: GEvent[]; needsConnect?: boolean };
				gev = Array.isArray(data.events) ? data.events : [];
				needConnect = data.needsConnect === true;
			} catch {
				// Offline or Google down - overlay stays empty.
			}
		})();
		return () => {
			dead = true;
		};
	});

	function gridRange(y: number, m: number): [number, number] {
		const first = new Date(y, m, 1);
		const lead = (first.getDay() + 6) % 7;
		const from = new Date(y, m, 1 - lead).getTime();
		const to = new Date(y, m, 1 - lead + 42).getTime();
		return [from, to];
	}

	function fmtTime(ts: number): string {
		try {
			return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	onMount(() => {
		loadTasks();
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') goto('/');
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
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

	const eventsByDay = $derived.by(() => {
		const map = new Map<string, GEvent[]>();
		for (const e of gev) {
			const k = keyOf(e.start);
			if (!map.has(k)) map.set(k, []);
			map.get(k)!.push(e);
		}
		for (const list of map.values()) {
			list.sort((a, b) => a.start - b.start);
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

	const todayKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate());

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
		return t.status === 'done' ? 'check_circle' : t.status === 'doing' ? 'timelapse' : 'circle';
	}
</script>

<div class="content">
	<div class="page-heading">
		<h1>Calendar</h1>
		<span class="heading-count">{unscheduled} without a date</span>
	</div>
	<div class="cal-head">
		<button class="nav" title="Previous month" onclick={() => shiftMonth(-1)} aria-label="Previous month">
			<span class="material-symbols-outlined">chevron_left</span>
		</button>
		<button class="month" onclick={goToday} title="Back to today">{monthLabel}</button>
		<button class="nav" title="Next month" onclick={() => shiftMonth(1)} aria-label="Next month">
			<span class="material-symbols-outlined">chevron_right</span>
		</button>
		<button class="today-btn" onclick={goToday}>Today</button>
		{#if needConnect}
			<button class="connect-btn" onclick={() => void connectCalendar()}>
				Connect Google Calendar
			</button>
		{/if}
	</div>

	<div class="calendar-layout">
		<div class="month-pane">
			<div class="grid" role="grid" aria-label="Task calendar">
			{#each WEEKDAYS as w (w)}
				<div class="dow">{w}</div>
			{/each}
			{#each cells as c (c.key)}
				{@const list = byDay.get(c.key) ?? []}
				{@const open = list.filter((t) => t.status !== 'done')}
				{@const evs = eventsByDay.get(c.key) ?? []}
				<button
					class="day"
					class:out={!c.inMonth}
					class:today={c.key === todayKey}
					class:sel={c.key === selected}
					onclick={() => (selected = c.key)}
					aria-label="{new Date(c.y, c.m, c.d).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}, {open.length} open tasks, {evs.length} events"
				>
					<span class="num">{c.d}</span>
					<span class="entries" aria-hidden="true">
						{#each open.slice(0, 2) as t (t.id)}
							<span class="entry task-entry" class:late={isOverdue(t)} title={t.title}>{t.title}</span>
						{/each}
						{#each evs.slice(0, Math.max(0, 2 - open.length)) as e (e.id)}
							<span class="entry event-entry" title={e.title}>{e.title}</span>
						{/each}
					</span>
					{#if open.length + evs.length > 2}
						<span class="more">
							+{open.length + evs.length - 2} more
						</span>
					{/if}
				</button>
			{/each}
			</div>
		</div>

		<section class="day-list" aria-label="Tasks on selected day">
			<div class="dhead">
				<span class="dlabel">{selectedLabel}</span>
				<span class="dcount">{selectedTasks.length + selectedEvents.length}</span>
			</div>
			{#if selectedEvents.length > 0}
				{#each selectedEvents as e (e.id)}
					<div class="evrow" title="Google Calendar event (read-only)">
						<span class="evtime">{e.allDay ? 'all day' : fmtTime(e.start)}</span>
						<span class="evtitle">{e.title}</span>
						<span class="evsrc">Google</span>
					</div>
				{/each}
			{/if}
			{#if selectedTasks.length === 0 && selectedEvents.length === 0}
				<p class="empty">Nothing due this day.</p>
			{:else}
				{#each selectedTasks as t (t.id)}
					<div
						class="row"
						class:done={t.status === 'done'}
						class:over={isOverdue(t)}
						onclick={(e) => {
							const el = e.target as HTMLElement;
							if (el.closest('button,input')) return;
							openTask(t.id);
						}}
						role="button"
						tabindex="0"
						aria-label="Open {t.title} details"
						onkeydown={(e) => {
							if (e.key === 'Enter' && (e.target as HTMLElement).classList.contains('row'))
								openTask(t.id);
						}}
					>
						<button
							class="status"
							title="Cycle status"
							onclick={() =>
								void updateTask(t.id, {
									status: t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo'
								})}
						>
							<span class="material-symbols-outlined">{statusIcon(t)}</span>
						</button>
						<div class="main">
							<span class="t-title">{t.title}</span>
							<span class="sub">
								{#if dueTimeValue(t.due_at)}
									<span class="time">{dueTimeValue(t.due_at)}</span>
								{:else}
									<span class="allday">all day</span>
								{/if}
								{#if t.priority !== 'none'}
									<span class="pri pri-{t.priority}">{t.priority}</span>
								{/if}
							</span>
						</div>
					</div>
				{/each}
			{/if}
		</section>
	</div>
</div>

<style>
	.content {
		max-width: 1200px;
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

	.cal-head {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 16px;
	}
	.nav {
		width: 28px;
		height: 28px;
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
	.nav:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.month {
		background: none;
		border: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: var(--radius);
	}
	.month:hover {
		background: var(--surface-container-low);
	}
	.today-btn {
		margin-left: auto;
		height: 28px;
		padding: 0 12px;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
	}
	.today-btn:hover {
		color: var(--primary);
		border-color: var(--primary);
	}
	.connect-btn {
		margin-left: 8px;
		height: 28px;
		padding: 0 12px;
		background: var(--primary);
		border: 1px solid var(--primary);
		border-radius: var(--radius);
		color: var(--on-primary);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		cursor: pointer;
		white-space: nowrap;
	}
	.connect-btn:hover {
		filter: brightness(1.08);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 1px;
		background: var(--border-default);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.calendar-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 28px;
		align-items: start;
	}
	.month-pane { min-width: 0; }
	.dow {
		text-align: center;
		font-size: 11px;
		font-weight: 500;
		color: var(--on-surface-variant);
		padding: 10px 0;
		background: var(--surface-container-low);
	}
	.day {
		min-height: 108px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
		padding: 8px;
		background: var(--background);
		border: 0;
		cursor: pointer;
		color: var(--on-surface);
		font-family: var(--font-ui);
	}
	.day:hover {
		background: var(--surface-container-low);
	}
	.day.out {
		background: var(--surface-container-lowest);
		color: var(--outline);
	}
	.day.sel {
		background: var(--surface-container);
		box-shadow: inset 0 0 0 1px var(--primary);
	}
	.day.today .num {
		background: var(--primary);
		color: var(--on-primary);
		border-radius: var(--radius-full);
	}
	.num {
		font-size: var(--font-ui-small);
		font-variant-numeric: tabular-nums;
		min-width: 24px;
		height: 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.entries {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.entry {
		display: block;
		width: 100%;
		padding: 3px 5px;
		border-radius: var(--radius-sm);
		font-size: 11px;
		line-height: 15px;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.task-entry {
		background: var(--secondary-container);
		color: var(--on-surface);
	}
	.task-entry.late {
		background: var(--error-container);
		color: var(--on-error-container);
	}
	.event-entry {
		background: var(--surface-container-high);
		color: var(--on-surface-variant);
		box-shadow: inset 2px 0 var(--primary);
	}
	.more {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		font-variant-numeric: tabular-nums;
	}

	.day-list {
		min-width: 0;
		padding-left: 24px;
		border-left: 1px solid var(--border-default);
	}
	.dhead {
		display: flex;
		align-items: baseline;
		gap: var(--stack-gap);
		padding-bottom: 6px;
		border-bottom: 1px solid var(--border-default);
	}
	.dlabel {
		font-size: 13px;
		font-weight: 600;
		color: var(--on-surface-variant);
	}
	.dcount {
		font-size: var(--font-label-caps);
		color: var(--outline-variant);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		color: var(--outline-variant);
		font-size: var(--font-ui-small);
		padding: 12px 2px;
		margin: 0;
	}

	.evrow {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 7px 6px;
		border-bottom: 1px solid var(--border-default);
	}
	.evtime {
		min-width: 64px;
		font-size: var(--font-ui-micro);
		color: var(--primary);
		font-variant-numeric: tabular-nums;
	}
	.evtitle {
		flex: 1;
		min-width: 0;
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.evsrc {
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		flex-shrink: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 6px;
		border-bottom: 1px solid var(--border-default);
		cursor: pointer;
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
		border-radius: var(--radius);
	}
	.status:hover {
		color: var(--primary);
	}
	.row.done .status {
		color: var(--success);
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
	.t-title {
		font-size: 13px;
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row.done .t-title {
		text-decoration: line-through;
		font-weight: var(--font-ui-small-weight);
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: var(--font-ui-micro);
		color: var(--outline);
		font-variant-numeric: tabular-nums;
	}
	.allday {
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

	button:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}
	@media (max-width: 680px) {
		.content { padding: 24px 16px 56px; }
		.page-heading { margin-bottom: 20px; }
		.cal-head { flex-wrap: wrap; }
		.connect-btn { margin-left: 0; }
		.day { min-height: 66px; padding: 5px 3px; }
		.num { min-width: 22px; height: 22px; }
		.entry { padding: 3px; font-size: 0; line-height: 6px; height: 6px; }
		.more { font-size: 9px; }
	}
	@media (max-width: 980px) {
		.calendar-layout { grid-template-columns: 1fr; gap: 24px; }
		.day-list { border-left: 0; padding-left: 0; }
	}
</style>
