import { tick } from 'svelte';
import { get } from 'svelte/store';
import { settings } from '$lib/stores/settings';
import { isTyping, leaderPending } from '$lib/stores/palette';

// Keyboard movement between task cards (Board) and rows (Tasks), attached
// to the page with {@attach keyNav}. Items carry data-task (the task id) and
// data-nav (their column); Board cards also carry data-nav-row (their lane).
// Up / Down (j / k with vim motions on) move within the column, Left /
// Right (h / l) to the nearest card in the next column of the same lane.
// Either key with nothing focused picks the first item.
const ITEMS = '[data-nav]';

type Dir = 'up' | 'down' | 'left' | 'right';

function dirOf(e: KeyboardEvent): Dir | null {
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
	const vim = get(settings).editor.vimMotions;
	switch (e.key) {
		case 'ArrowUp':
			return 'up';
		case 'ArrowDown':
			return 'down';
		case 'ArrowLeft':
			return 'left';
		case 'ArrowRight':
			return 'right';
	}
	if (!vim) return null;
	return ({ k: 'up', j: 'down', h: 'left', l: 'right' } as const)[e.key] ?? null;
}

function target(root: HTMLElement, from: HTMLElement, dir: Dir): HTMLElement | undefined {
	const all = [...root.querySelectorAll<HTMLElement>(ITEMS)];
	const col = from.dataset.nav;
	const row = from.dataset.navRow;
	if (dir === 'up' || dir === 'down') {
		const same = all.filter((el) => el.dataset.nav === col);
		return same[same.indexOf(from) + (dir === 'down' ? 1 : -1)];
	}
	const lane = all.filter((el) => el.dataset.navRow === row);
	// Columns in DOM order; empty ones have no cards, so they are skipped.
	const cols = [...new Set(lane.map((el) => el.dataset.nav))];
	const next = cols[cols.indexOf(col) + (dir === 'right' ? 1 : -1)];
	if (next === undefined) return undefined;
	const index = lane.filter((el) => el.dataset.nav === col).indexOf(from);
	const cards = lane.filter((el) => el.dataset.nav === next);
	return cards[Math.min(index, cards.length - 1)];
}

export function keyNav(root: HTMLElement) {
	const onKey = (e: KeyboardEvent) => {
		const dir = dirOf(e);
		if (!dir || e.defaultPrevented || get(leaderPending)) return;
		const active = document.activeElement;
		let to: HTMLElement | undefined;
		if (active instanceof HTMLElement && active.matches(ITEMS) && root.contains(active)) {
			to = target(root, active, dir);
		} else if (active === document.body && !isTyping(e.target)) {
			to = root.querySelector<HTMLElement>(ITEMS) ?? undefined;
		} else return;
		e.preventDefault();
		to?.focus();
		to?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	};
	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
}

// Put focus back on a task's card or row once it re-renders, e.g. after a
// keyboard move to another column, so the next key keeps working on it.
export async function refocusTask(id: string) {
	await tick();
	document.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"]`)?.focus();
}
