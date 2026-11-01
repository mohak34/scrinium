<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ContextMenu from './ContextMenu.svelte';
	import { openTask, projects, dueLabel, startOfToday, startOfTomorrow, type Task } from '$lib/stores/tasks';
	import { projectStyle, colorVar, projectLabel } from '$lib/projects';
	import {
		reminders,
		remindersOpen,
		pollReminders,
		completeReminder,
		snoozeReminder,
		clearReminder,
		snoozeChoices
	} from '$lib/stores/reminders';

	// Top-right reminder panel, mounted by the root layout. It opens when a
	// reminder fires and lists every one still waiting; closing it leaves them
	// on the bottom-bar bell (ReminderBell).
	let snooze = $state<{ x: number; y: number; ids: string[]; anchor: HTMLElement } | null>(null);

	function since(ms: number): string {
		const m = Math.round(ms / 60000);
		return m < 60 ? `${Math.max(m, 1)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
	}

	function when(t: Task): { text: string; late: boolean } {
		const now = Date.now();
		if (t.due_at == null) return { text: `reminded ${new Date(t.remind_at!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, late: false };
		const d = new Date(t.due_at);
		if (d.getHours() === 0 && d.getMinutes() === 0) {
			if (t.due_at < startOfToday()) return { text: `overdue ${since(startOfToday() - t.due_at)}`, late: true };
			return { text: t.due_at < startOfTomorrow() ? 'due today' : `due ${dueLabel(t.due_at)}`, late: false };
		}
		if (t.due_at < now) return { text: `overdue ${since(now - t.due_at)}`, late: true };
		if (t.due_at < startOfTomorrow()) return { text: `due ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, late: false };
		return { text: `due ${dueLabel(t.due_at)}`, late: false };
	}

	const color = (key: string | null) => colorVar(projectStyle(key, $projects.find((p) => p.path === key)).color);

	function open(t: Task) {
		remindersOpen.set(false);
		if (!page.url.pathname.startsWith('/tasks')) void goto('/tasks');
		openTask(t.id);
	}

	function askSnooze(e: MouseEvent, ids: string[]) {
		const el = e.currentTarget as HTMLElement;
		const r = el.getBoundingClientRect();
		snooze = { x: r.right - 180, y: r.bottom + 4, ids, anchor: el };
	}

	// Polls every 30 s while the tab is visible. A hidden tab stops polling;
	// coming back polls at once, so a reminder that came due meanwhile shows
	// on return.
	$effect(() => {
		let timer: ReturnType<typeof setInterval> | undefined;
		const start = () => {
			clearInterval(timer);
			if (document.hidden) return;
			void pollReminders();
			timer = setInterval(() => void pollReminders(), 30000);
		};
		const onFocus = () => void pollReminders();
		start();
		document.addEventListener('visibilitychange', start);
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', start);
			window.removeEventListener('focus', onFocus);
		};
	});
</script>

{#if $remindersOpen && $reminders.length > 0}
	<div class="panel" role="region" aria-label="Task reminders">
		<div class="hd">
			<span class="material-symbols-outlined fill bell">notifications</span>
			<span class="count">{$reminders.length} {$reminders.length === 1 ? 'reminder' : 'reminders'}</span>
			{#if $reminders.length > 1}
				<button class="txt" onclick={(e) => askSnooze(e, $reminders.map((t) => t.id))}>Snooze all</button>
			{/if}
			<button class="icon" onclick={() => remindersOpen.set(false)} title="Hide (the bell keeps them)" aria-label="Hide reminders">
				<span class="material-symbols-outlined">close</span>
			</button>
		</div>
		<div class="rows">
			{#each $reminders as t (t.id)}
				{@const w = when(t)}
				<div class="row">
					<button class="cb" onclick={() => completeReminder(t.id)} title="Done" aria-label="Mark done"></button>
					<button class="body" onclick={() => open(t)} title="Open task">
						<span class="title">{t.title}</span>
						<span class="meta">
							<span class="pj"><i style:background={color(t.project)}></i>{projectLabel(t.project)}</span>
							<span class:late={w.late}>{w.text}</span>
						</span>
					</button>
					<span class="acts">
						<button class="icon" onclick={(e) => askSnooze(e, [t.id])} title="Snooze" aria-label="Snooze">
							<span class="material-symbols-outlined">snooze</span>
						</button>
						<button class="icon" onclick={() => clearReminder(t.id)} title="Clear reminder" aria-label="Clear reminder">
							<span class="material-symbols-outlined">notifications_off</span>
						</button>
					</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

{#if snooze}
	{@const s = snooze}
	<ContextMenu
		x={s.x}
		y={s.y}
		width={180}
		anchor={s.anchor}
		items={snoozeChoices().map((c) => ({ label: c.label, action: () => s.ids.forEach((id) => snoozeReminder(id, c.at)) }))}
		onClose={() => (snooze = null)}
	/>
{/if}

<style>
	.panel {
		position: fixed;
		top: 46px;
		right: 12px;
		z-index: 100;
		width: min(340px, calc(100vw - 24px));
		max-height: min(420px, calc(100vh - 92px));
		display: flex;
		flex-direction: column;
		background: var(--raise);
		border: 1px solid var(--line-2);
		border-radius: var(--r-md);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.8);
		font-family: var(--font-ui);
	}
	.hd {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 6px 6px 12px;
		border-bottom: 1px solid var(--line);
		font-size: var(--fs-sm);
		color: var(--text-2);
	}
	.bell {
		font-size: 16px;
		color: var(--orange);
	}
	.count {
		flex: 1;
	}
	.rows {
		overflow-y: auto;
	}
	.row {
		display: grid;
		grid-template-columns: 16px 1fr auto;
		gap: 10px;
		align-items: start;
		padding: 8px 6px 8px 12px;
		border-bottom: 1px solid var(--line);
	}
	.row:last-child {
		border-bottom: none;
	}
	.row:hover {
		background: var(--hover);
	}
	button {
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	.cb {
		width: 15px;
		height: 15px;
		margin-top: 2px;
		border: 1.5px solid var(--line-3);
		border-radius: var(--r-sm);
	}
	.cb:hover {
		border-color: var(--accent);
	}
	.body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
	}
	.title {
		font-size: var(--fs-sm);
		color: var(--text);
		line-height: 1.35;
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		gap: 8px;
		font-size: var(--fs-xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.pj {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.pj i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.late {
		color: var(--red);
	}
	.acts {
		display: flex;
		opacity: 0.5;
	}
	.row:hover .acts,
	.acts:focus-within {
		opacity: 1;
	}
	.icon {
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: var(--r-sm);
		color: var(--text-2);
	}
	.icon .material-symbols-outlined {
		font-size: 17px;
	}
	.icon:hover,
	.txt:hover {
		background: var(--press);
		color: var(--text);
	}
	.txt {
		padding: 3px 8px;
		border-radius: var(--r-sm);
		font-size: var(--fs-xs);
		color: var(--text-3);
	}
	button:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: 1px;
	}
</style>
