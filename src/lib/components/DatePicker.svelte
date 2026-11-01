<script lang="ts">
	import { tick } from 'svelte';

	// A themed date (and time) field: a chip that opens quick picks, a month
	// calendar and, unless `time` is 'none', a column of times. Values are
	// epoch ms in local time. With `time: 'optional'` local midnight means
	// "no time" (an all-day due date); 'required' gives a day without a
	// time 9:00 AM.
	interface Props {
		value: number | null;
		onchange: (value: number | null) => void;
		label: string;
		placeholder?: string;
		icon?: string;
		time?: 'optional' | 'required' | 'none';
	}
	let { value, onchange, label, placeholder = 'Pick a date', icon = 'event', time = 'optional' }: Props =
		$props();

	const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
	const pad = (n: number) => String(n).padStart(2, '0');
	const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const fromKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
	const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
	const clock = (hhmm: string) =>
		new Date(2000, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3))).toLocaleTimeString([], {
			hour: 'numeric',
			minute: '2-digit'
		});

	const picked = $derived(value == null ? null : new Date(value));
	const pickedDay = $derived(picked ? dayKey(picked) : null);
	// '' is no time: midnight on an optional field, always on a date-only one.
	const pickedTime = $derived(
		!picked || time === 'none' || (time === 'optional' && picked.getHours() === 0 && picked.getMinutes() === 0)
			? ''
			: `${pad(picked.getHours())}:${pad(picked.getMinutes())}`
	);

	function dayLabel(d: Date) {
		const today = new Date();
		const k = dayKey(d);
		if (k === dayKey(today)) return 'Today';
		if (k === dayKey(addDays(today, 1))) return 'Tomorrow';
		if (k === dayKey(addDays(today, -1))) return 'Yesterday';
		return d.toLocaleDateString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' })
		});
	}
	const shown = $derived(picked ? dayLabel(picked) + (pickedTime ? `, ${clock(pickedTime)}` : '') : '');
	const overdue = $derived(value != null && time !== 'none' && value < Date.now() && pickedDay !== dayKey(new Date()));

	function set(day: string, hhmm: string) {
		const t = time === 'none' ? '' : hhmm || (time === 'required' ? pickedTime || '09:00' : '');
		const d = fromKey(day);
		if (t) d.setHours(Number(t.slice(0, 2)), Number(t.slice(3)));
		const next = d.getTime();
		if (next !== value) onchange(next);
	}

	// Times every 30 minutes, plus the picked one when it falls between.
	const times = $derived.by(() => {
		const out: string[] = [];
		for (let m = time === 'optional' ? 30 : 0; m < 24 * 60; m += 30) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
		if (pickedTime && !out.includes(pickedTime)) out.push(pickedTime);
		return out.sort();
	});

	const QUICK = [
		{ label: 'Today', day: () => new Date() },
		{ label: 'Tomorrow', day: () => addDays(new Date(), 1) },
		{ label: 'Next Mon', day: () => addDays(new Date(), ((8 - new Date().getDay()) % 7) || 7) },
		{ label: 'In a week', day: () => addDays(new Date(), 7) }
	];

	let chip = $state<HTMLButtonElement>();
	let pop = $state<HTMLDivElement>();
	let timeList = $state<HTMLDivElement>();
	let open = $state(false);
	let month = $state(new Date());
	let left = $state(0);
	let top = $state(0);

	const cells = $derived.by(() => {
		const first = new Date(month.getFullYear(), month.getMonth(), 1);
		const lead = (first.getDay() + 6) % 7;
		const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
		return Array.from({ length: Math.ceil((lead + count) / 7) * 7 }, (_, i) => addDays(first, i - lead));
	});

	async function show() {
		const at = picked ?? new Date();
		month = new Date(at.getFullYear(), at.getMonth(), 1);
		open = true;
		await tick();
		place();
		const row = timeList?.querySelector<HTMLElement>('.on') ?? timeList?.querySelector<HTMLElement>('[data-time="09:00"]');
		if (row && timeList) timeList.scrollTop = row.offsetTop - timeList.clientHeight / 2 + row.clientHeight / 2;
		pop?.querySelector<HTMLElement>('.day.on, .day.today')?.focus({ preventScroll: true });
	}
	// Below the chip when it fits, else above, else on the roomier side;
	// kept inside the window either way.
	function place() {
		if (!chip || !pop) return;
		const c = chip.getBoundingClientRect();
		const p = pop.getBoundingClientRect();
		left = Math.max(8, Math.min(c.left, window.innerWidth - p.width - 8));
		const below = window.innerHeight - 8 - (c.bottom + 4);
		const above = c.top - 4 - 8;
		top =
			p.height <= below || below >= above
				? Math.max(8, Math.min(c.bottom + 4, window.innerHeight - 8 - p.height))
				: Math.max(8, c.top - 4 - p.height);
	}
	function close(refocus = true) {
		open = false;
		if (refocus) chip?.focus({ preventScroll: true });
	}
	function pickDay(d: Date) {
		set(dayKey(d), pickedTime);
		if (time === 'none') close();
	}

	$effect(() => {
		if (!open) return;
		const down = (e: PointerEvent) => {
			const t = e.target as Node;
			if (pop?.contains(t)) return;
			if (chip?.contains(t)) {
				e.preventDefault();
				chip.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
			}
			close(false);
		};
		// Claimed like the menu's keys, so nothing under the popover sees them.
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
			else if (!gridKey(e)) return;
			e.preventDefault();
			e.stopPropagation();
		};
		const moved = (e: Event) => {
			if (!pop?.contains(e.target as Node)) close(false);
		};
		window.addEventListener('pointerdown', down, true);
		window.addEventListener('keydown', key, true);
		window.addEventListener('scroll', moved, true);
		window.addEventListener('resize', place);
		return () => {
			window.removeEventListener('pointerdown', down, true);
			window.removeEventListener('keydown', key, true);
			window.removeEventListener('scroll', moved, true);
			window.removeEventListener('resize', place);
		};
	});

	// Arrow keys walk the calendar by day and week; the month follows.
	function gridKey(e: KeyboardEvent): boolean {
		const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
		const k = (document.activeElement as HTMLElement | null)?.dataset.day;
		if (!step || !k || !pop?.contains(document.activeElement)) return false;
		const next = addDays(fromKey(k), step);
		month = new Date(next.getFullYear(), next.getMonth(), 1);
		void tick().then(() => pop?.querySelector<HTMLElement>(`[data-day="${dayKey(next)}"]`)?.focus());
		return true;
	}
</script>

<button
	bind:this={chip}
	type="button"
	class="chip"
	class:empty={value == null}
	class:open
	class:late={overdue}
	aria-label={label}
	aria-haspopup="dialog"
	aria-expanded={open}
	onclick={() => (open ? close() : void show())}
>
	<span class="material-symbols-outlined">{icon}</span>
	<span class="txt">{shown || placeholder}</span>
</button>

{#if open}
	<div class="pop date-pop" role="dialog" aria-label={label} bind:this={pop} style:left="{left}px" style:top="{top}px">
		<div class="cal">
			<div class="quick">
				{#each QUICK as q (q.label)}
					<button type="button" class:on={pickedDay === dayKey(q.day())} onclick={() => pickDay(q.day())}>
						{q.label}
					</button>
				{/each}
			</div>
			<div class="head">
				<button
					type="button"
					title="Previous month"
					onclick={() => (month = new Date(month.getFullYear(), month.getMonth() - 1, 1))}
				>
					<span class="material-symbols-outlined">chevron_left</span>
				</button>
				<span>{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
				<button
					type="button"
					title="Next month"
					onclick={() => (month = new Date(month.getFullYear(), month.getMonth() + 1, 1))}
				>
					<span class="material-symbols-outlined">chevron_right</span>
				</button>
			</div>
			<div class="grid">
				{#each WEEKDAYS as w (w)}<span class="wd">{w}</span>{/each}
				{#each cells as d (dayKey(d))}
					{@const k = dayKey(d)}
					<button
						type="button"
						class="day"
						class:other={d.getMonth() !== month.getMonth()}
						class:today={k === dayKey(new Date())}
						class:on={k === pickedDay}
						data-day={k}
						tabindex={k === (pickedDay ?? dayKey(new Date())) ? 0 : -1}
						aria-label={d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
						aria-pressed={k === pickedDay}
						onclick={() => pickDay(d)}>{d.getDate()}</button
					>
				{/each}
			</div>
			{#if value != null}
				<div class="foot">
					<span>{shown}</span>
					<button
						type="button"
						onclick={() => {
							onchange(null);
							close();
						}}>Clear</button
					>
				</div>
			{/if}
		</div>
		{#if time !== 'none'}
			<div class="times" bind:this={timeList}>
				{#if time === 'optional'}
					<button
						type="button"
						class:on={pickedDay != null && !pickedTime}
						onclick={() => {
							set(pickedDay ?? dayKey(new Date()), '');
							close();
						}}>No time</button
					>
				{/if}
				{#each times as t (t)}
					<button
						type="button"
						class:on={t === pickedTime}
						data-time={t}
						onclick={() => {
							set(pickedDay ?? dayKey(new Date()), t);
							close();
						}}>{clock(t)}</button
					>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.chip {
		height: 30px;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 10px 0 8px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: var(--bg);
		color: var(--text);
		font: var(--fs) var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
	}
	.chip .material-symbols-outlined {
		font-size: 17px;
		color: var(--text-3);
	}
	.chip:hover {
		border-color: var(--line-3);
	}
	.chip.open,
	.chip:focus-visible {
		outline: none;
		border-color: var(--accent);
	}
	.chip.empty {
		color: var(--text-3);
	}
	.chip.late .txt {
		color: var(--red);
	}
	.txt {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pop {
		position: fixed;
		z-index: 1000;
		display: flex;
		max-width: calc(100vw - 16px);
		background: var(--raise);
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow);
		font: var(--fs-sm) var(--font-ui);
		color: var(--text);
	}
	.pop button {
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.cal {
		padding: 8px;
		width: 256px;
		flex-shrink: 0;
	}
	.quick {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
		margin-bottom: 6px;
	}
	.quick button {
		height: 26px;
		padding: 0 4px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		color: var(--text-2);
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.quick button:hover {
		color: var(--text);
		border-color: var(--line-3);
	}
	.quick button.on {
		color: var(--accent);
		border-color: var(--accent);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 32px;
		font-weight: 500;
	}
	.head button {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border-radius: var(--r);
		color: var(--text-2);
	}
	.head button:hover {
		background: var(--hover);
		color: var(--text);
	}
	.head .material-symbols-outlined {
		font-size: 18px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}
	.wd {
		height: 24px;
		display: grid;
		place-items: center;
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
	.day {
		height: 32px;
		border-radius: var(--r);
		font-variant-numeric: tabular-nums;
	}
	.day:hover {
		background: var(--hover);
	}
	.day:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.day.other {
		color: var(--text-4);
	}
	.day.today {
		color: var(--accent);
		font-weight: 600;
	}
	.day.on {
		background: var(--accent-fill);
		color: var(--on-accent);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		padding-top: 6px;
		border-top: 1px solid var(--line-2);
		color: var(--text-3);
	}
	.foot span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.foot button {
		height: 26px;
		padding: 0 8px;
		border-radius: var(--r);
		color: var(--text-2);
	}
	.foot button:hover {
		background: var(--hover);
		color: var(--text);
	}
	.times {
		width: 104px;
		flex-shrink: 0;
		/* No height of its own: the calendar sets the popover's, the list
		   stretches to it and scrolls. */
		contain: size;
		overflow-y: auto;
		padding: 8px 6px;
		border-left: 1px solid var(--line-2);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.times button {
		flex-shrink: 0;
		height: 28px;
		padding: 0 8px;
		border-radius: var(--r);
		text-align: left;
		color: var(--text-2);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.times button:hover {
		background: var(--hover);
		color: var(--text);
	}
	.times button.on {
		background: var(--accent-fill);
		color: var(--on-accent);
	}
</style>
