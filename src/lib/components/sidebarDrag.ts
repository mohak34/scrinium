import { get, writable } from 'svelte/store';
import { collapsedDirs, expandDir, parentDirOf } from '$lib/stores/filetree';

// Pointer-driven drag for the notes sidebar. Tree rows move into folders, a
// file dropped on the top or bottom half of another file lands right before
// or after it (in that file's folder), notes and folders dropped on Pinned get pinned globally and on their project's pins
// in that project, pins reorder, move into a folder when dropped on one
// (staying pinned), and unpin when dropped anywhere else.
// Built on pointer events instead of HTML5 drag-and-drop so the lifted row,
// the target highlight and Esc-to-cancel are drawn by us, and hovering a
// file or a folder's children still counts as that folder.
//
// Targets are found in the DOM under the pointer:
//   [data-drop-pins]  a pin list: global, or one project's when it carries
//                     data-project; [data-pin=path] its rows, with
//                     data-pin-dir on pinned folders (their middle
//                     moves into the folder). The switcher
//                     bar and a project header carry it too, plus
//                     data-pin-here, while the dragged item can pin there.
//   [data-tree-entry] a tree row (data-path, data-type)
//   [data-drop-dir]   a project section, moving into its folder ("" is the
//                     vault root, Quotidian)
//   [data-drag-scroll] the container that autoscrolls near its edges

export interface DragSource {
	path: string;
	kind: 'file' | 'directory';
	fromPins: boolean;
	// The project the path belongs to, "" for Quotidian: a note only pins
	// onto its own project's list.
	project: string;
}

export type DropTarget =
	| { kind: 'move'; dir: string | null; place?: { path: string; after: boolean } }
	| { kind: 'pin'; before: string | null; global: boolean }
	| { kind: 'unpin' };

export interface DragState {
	source: DragSource;
	target: DropTarget | null;
	// Where the lifted row is drawn: it keeps the picked-up row's column and
	// follows the pointer vertically.
	top: number;
	left: number;
	width: number;
}

export const drag = writable<DragState | null>(null);

const THRESHOLD = 4;
const EXPAND_DELAY = 600;
const EDGE = 32;

// A move is valid unless it lands where the item already is, or puts a
// folder inside itself.
export function canMove(source: DragSource, dir: string | null): boolean {
	if (parentDirOf(source.path) === dir) return false;
	if (source.kind === 'directory' && dir !== null) {
		if (dir === source.path || dir.startsWith(source.path + '/')) return false;
	}
	return true;
}

// Insert position from the pointer's height against the pin rows; null when
// the drop would leave the order unchanged. Pinned folders list before
// pinned notes, so each lands within its own group.
function pinTarget(source: DragSource, pins: HTMLElement, y: number, global: boolean): DropTarget | null {
	const rows = Array.from(pins.querySelectorAll<HTMLElement>('[data-pin]'));
	let at = rows.findIndex((r) => {
		const b = r.getBoundingClientRect();
		return y < b.top + b.height / 2;
	});
	if (at === -1) at = rows.length;
	const dirs = rows.filter((r) => r.dataset.pinDir !== undefined).length;
	at = source.kind === 'directory' ? Math.min(at, dirs) : Math.max(at, dirs);
	const paths = rows.map((r) => r.dataset.pin ?? '');
	const from = paths.indexOf(source.path);
	if (from !== -1 && (at === from || at === from + 1)) return null;
	return { kind: 'pin', before: paths[at] ?? null, global };
}

// The folder a tree row stands for: a folder row itself, a file row its
// parent, a section's header or empty space its folder (the root, null, for
// Quotidian). Undefined when the pointer is not over a section.
function treeDir(el: Element | null): string | null | undefined {
	const entry = el?.closest<HTMLElement>('[data-tree-entry]');
	if (entry?.dataset.path) {
		return entry.dataset.type === 'directory' ? entry.dataset.path : parentDirOf(entry.dataset.path);
	}
	const section = el?.closest<HTMLElement>('[data-drop-dir]');
	return section ? section.dataset.dropDir || null : undefined;
}

// A file over another file row: the side of that row it would land on, or
// null when that is where it already sits.
function placeTarget(source: DragSource, row: HTMLElement, y: number): DropTarget | null {
	const path = row.dataset.path ?? '';
	const b = row.getBoundingClientRect();
	const after = y > b.top + b.height / 2;
	const li = row.closest('li');
	const next = after ? li?.nextElementSibling : li?.previousElementSibling;
	const beside = next?.querySelector<HTMLElement>('[data-tree-entry]')?.dataset.path;
	if (path === source.path || beside === source.path) return null;
	return { kind: 'move', dir: parentDirOf(path), place: { path, after } };
}

function resolve(source: DragSource, x: number, y: number): DropTarget | null {
	const el = document.elementFromPoint(x, y);
	const row = el?.closest<HTMLElement>('[data-tree-entry]');
	if (row?.dataset.type === 'file' && source.kind === 'file' && !source.fromPins) {
		return placeTarget(source, row, y);
	}
	// A pinned folder's own tree sits inside its pin list; its rows move.
	const pins = row ? null : el?.closest<HTMLElement>('[data-drop-pins]');
	if (pins) {
		// The middle of a pinned folder moves into it; its edges reorder.
		const dirRow = el?.closest<HTMLElement>('[data-pin-dir]');
		const into = dirRow?.dataset.pin;
		if (dirRow && into) {
			const b = dirRow.getBoundingClientRect();
			const middle = y > b.top + b.height / 4 && y < b.bottom - b.height / 4;
			if (middle && canMove(source, into)) return { kind: 'move', dir: into };
		}
		const project = pins.dataset.project;
		const pinnable =
			(source.fromPins || source.kind === 'directory' || source.path.endsWith('.md')) &&
			(project === undefined || project === source.project);
		return pinnable ? pinTarget(source, pins, y, project === undefined) : null;
	}
	const dir = treeDir(el);
	if (dir !== undefined && canMove(source, dir)) return { kind: 'move', dir };
	// A pin let go anywhere else leaves the Pinned list.
	return source.fromPins ? { kind: 'unpin' } : null;
}

function swallowClick(e: MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
}

// Called from a row's pointerdown. Nothing happens until the pointer travels
// a few pixels, so plain clicks keep opening and toggling rows.
export function beginDrag(
	e: PointerEvent,
	source: DragSource,
	onDrop: (source: DragSource, target: DropTarget) => void
) {
	if (e.button !== 0 || get(drag)) return;
	const row = e.currentTarget as HTMLElement;
	const scroller = row.closest<HTMLElement>('[data-drag-scroll]');
	const rect = row.getBoundingClientRect();
	const startX = e.clientX;
	const startY = e.clientY;
	const grabY = startY - rect.top;
	let x = startX;
	let y = startY;
	let started = false;
	let frame = 0;
	let expandFor: string | null = null;
	let expandTimer: ReturnType<typeof setTimeout> | undefined;

	function update() {
		const target = resolve(source, x, y);
		// Hovering a collapsed folder opens it after a beat.
		const dir = target?.kind === 'move' ? target.dir : null;
		if (dir !== expandFor) {
			clearTimeout(expandTimer);
			expandFor = dir;
			if (dir && get(collapsedDirs).has(dir)) {
				expandTimer = setTimeout(() => expandDir(dir), EXPAND_DELAY);
			}
		}
		drag.set({ source, target, top: y - grabY, left: rect.left, width: rect.width });
	}

	// Scrolls while the pointer sits near the top or bottom edge of the list;
	// the scroll listener re-resolves the target under the pointer.
	function autoscroll() {
		frame = 0;
		if (!scroller) return;
		const b = scroller.getBoundingClientRect();
		if (x < b.left || x > b.right) return;
		// The switcher bar and a sticky project header sit in the edge zone;
		// scrolling under a pin target would swap the header being dropped on.
		if (document.elementFromPoint(x, y)?.closest('[data-pin-here]')) return;
		const depth = y < b.top + EDGE ? y - (b.top + EDGE) : y > b.bottom - EDGE ? y - (b.bottom - EDGE) : 0;
		if (!depth) return;
		scroller.scrollTop += Math.max(-EDGE, Math.min(EDGE, depth)) / 2;
		frame = requestAnimationFrame(autoscroll);
	}

	function move(ev: PointerEvent) {
		if (ev.pointerId !== e.pointerId) return;
		x = ev.clientX;
		y = ev.clientY;
		if (!started) {
			if (Math.hypot(x - startX, y - startY) < THRESHOLD) return;
			started = true;
			document.documentElement.classList.add('sidebar-dragging');
		}
		update();
		if (!frame) frame = requestAnimationFrame(autoscroll);
	}

	function finish(drop: boolean) {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', cancel);
		window.removeEventListener('keydown', key, true);
		scroller?.removeEventListener('scroll', onScroll);
		cancelAnimationFrame(frame);
		clearTimeout(expandTimer);
		const target = get(drag)?.target ?? null;
		drag.set(null);
		if (!started) return;
		document.documentElement.classList.remove('sidebar-dragging');
		// The release still fires a click on whatever row is under it; a drop
		// must never also open or toggle that row.
		window.addEventListener('click', swallowClick, { capture: true, once: true });
		setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
		if (drop && target) onDrop(source, target);
	}

	// The pin targets only render once the drag has started, so the target is
	// read again where the pointer is let go.
	function up(ev: PointerEvent) {
		if (ev.pointerId !== e.pointerId) return;
		if (started) {
			x = ev.clientX;
			y = ev.clientY;
			update();
		}
		finish(true);
	}
	function cancel(ev: PointerEvent) {
		if (ev.pointerId === e.pointerId) finish(false);
	}
	// Esc cancels the drag and stops there, so it doesn't also toggle preview.
	function key(ev: KeyboardEvent) {
		if (!started || ev.key !== 'Escape') return;
		ev.preventDefault();
		ev.stopPropagation();
		finish(false);
	}
	function onScroll() {
		if (started) update();
	}

	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', cancel);
	window.addEventListener('keydown', key, true);
	scroller?.addEventListener('scroll', onScroll);
}
