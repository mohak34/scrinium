<script lang="ts">
	import { goto } from '$app/navigation';
	import { APPS, type AppKey } from '$lib/apps';
	import { tree, openTabs, flushSave, type VaultEntry } from '$lib/stores/vault';
	import { tasks, loadTasks, isOverdue, isDueToday, dueLabel } from '$lib/stores/tasks';

	// Top-left title of every page. Shows the current app; the menu lists all
	// four with a live line each so the switch doubles as a glance.
	interface Props {
		current: AppKey;
		size?: 'md' | 'lg';
	}
	let { current, size = 'md' }: Props = $props();

	let open = $state(false);
	let wrapEl = $state<HTMLDivElement>();
	let active = $state(0);
	let nextEvent = $state<string | null>(null);

	const me = $derived(APPS.find((a) => a.key === current)!);

	function countNotes(entries: VaultEntry[]): number {
		let n = 0;
		for (const e of entries) {
			if (e.type === 'directory') n += countNotes(e.children ?? []);
			else if (e.name.endsWith('.md')) n++;
		}
		return n;
	}

	const info = $derived.by(() => {
		const open = $tasks.filter((t) => t.status !== 'done' && t.parent_id == null);
		const overdue = open.filter(isOverdue).length;
		const today = open.filter((t) => isDueToday(t)).length;
		const doing = open.filter((t) => t.status === 'doing').length;
		const waiting = open.filter((t) => t.status === 'waiting').length;
		const nextTask = open
			.filter((t) => t.due_at != null && t.due_at >= Date.now())
			.sort((a, b) => a.due_at! - b.due_at!)[0];
		const notes = countNotes($tree);
		const tabs = $openTabs.length;
		const taskLine = [today && `${today} due today`, overdue && `${overdue} overdue`]
			.filter(Boolean)
			.join(', ');
		return {
			notes: `${notes} notes${tabs ? `, ${tabs} open tab${tabs === 1 ? '' : 's'}` : ''}`,
			tasks: taskLine || `${open.length} open`,
			board: `${doing} doing, ${waiting} waiting`,
			calendar:
				nextEvent ?? (nextTask ? `Next: ${nextTask.title}, ${dueLabel(nextTask.due_at)}` : 'Nothing scheduled'),
			alert: overdue > 0
		} satisfies Record<AppKey, string> & { alert: boolean };
	});

	// Google events are optional; a failed or unconnected fetch just leaves
	// the calendar line on the next dated task.
	async function loadNextEvent() {
		const now = Date.now();
		try {
			const res = await fetch(`/api/calendar/events?from=${now}&to=${now + 7 * 86400000}`);
			if (!res.ok) return;
			const data = (await res.json()) as { events: { title: string; start: number; allDay: boolean }[] };
			const ev = data.events.filter((e) => e.start >= now - 3600000).sort((a, b) => a.start - b.start)[0];
			if (ev) {
				const d = new Date(ev.start);
				const when = ev.allDay
					? d.toLocaleDateString([], { weekday: 'short' })
					: d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
				nextEvent = `Next: ${ev.title}, ${when}`;
			}
		} catch {
			// offline or not connected: keep the task fallback
		}
	}

	function toggle(e: MouseEvent) {
		e.stopPropagation();
		open = !open;
		if (open) {
			active = APPS.findIndex((a) => a.key === current);
			if ($tasks.length === 0) void loadTasks();
			void loadNextEvent();
		}
	}

	async function go(href: string) {
		open = false;
		await flushSave();
		goto(href);
	}

	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (wrapEl && !wrapEl.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
			else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				active = (active + (e.key === 'ArrowDown' ? 1 : APPS.length - 1)) % APPS.length;
			} else if (e.key === 'Enter') {
				e.preventDefault();
				void go(APPS[active].href);
			}
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="switcher" bind:this={wrapEl}>
	<button
		class="trigger {size}"
		class:open
		onclick={toggle}
		aria-haspopup="menu"
		aria-expanded={open}
		title="Switch app (Ctrl+Shift+1 to 4)"
	>
		<span class="material-symbols-outlined fill app-icon">{me.icon}</span>
		<span class="label">{me.label}</span>
		<span class="material-symbols-outlined chev">expand_more</span>
	</button>
	{#if open}
		<div class="menu" role="menu" aria-label="Switch app">
			{#each APPS as a, i (a.key)}
				<button
					class="item"
					class:on={a.key === current}
					class:active={i === active}
					role="menuitem"
					onmouseenter={() => (active = i)}
					onclick={() => void go(a.href)}
				>
					<span class="material-symbols-outlined icon" class:fill={a.key === current}>{a.icon}</span>
					<span class="text">
						<span class="name">{a.label}</span>
						<span class="sub" class:alert={a.key === 'tasks' && info.alert}>{info[a.key]}</span>
					</span>
					<span class="kbd">Ctrl Shift {i + 1}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.switcher {
		position: relative;
		min-width: 0;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 6px 0 6px;
		margin-left: -6px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: 600 15px var(--font-ui);
		cursor: pointer;
		max-width: 100%;
	}
	.trigger.lg {
		font-size: 18px;
		height: 36px;
	}
	.trigger:hover,
	.trigger.open {
		background: var(--hover);
	}
	.app-icon {
		font-size: 19px;
		color: var(--accent);
	}
	.label {
		white-space: nowrap;
	}
	.chev {
		font-size: 18px;
		color: var(--text-3);
		transition: transform 0.15s ease;
	}
	.trigger.open .chev {
		transform: rotate(180deg);
	}
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		left: -6px;
		z-index: 1000;
		width: 320px;
		background: var(--panel);
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		padding: 5px;
		box-shadow: var(--shadow);
		display: flex;
		flex-direction: column;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: var(--text-2);
		padding: 8px 10px;
		border-radius: var(--r);
		cursor: pointer;
	}
	.item.active {
		background: var(--hover);
		color: var(--text);
	}
	.item.on {
		background: var(--accent-dim);
		color: var(--text);
	}
	.icon {
		font-size: 21px;
		color: var(--text-3);
	}
	.item.on .icon {
		color: var(--accent);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		font-size: var(--fs-md);
	}
	.sub {
		font-size: var(--fs-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub.alert {
		color: var(--red);
	}
</style>
