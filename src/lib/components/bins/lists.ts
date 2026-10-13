// Date groups and row labels shared by the Archive and Trash tabs.

const DAY = 86400000;
export const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;
type Group = (typeof GROUPS)[number];

function groupOf(at: number): Group {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	if (!at) return 'Older';
	if (at >= today) return 'Today';
	if (at >= today - DAY) return 'Yesterday';
	if (at >= today - 7 * DAY) return 'Previous 7 days';
	return 'Older';
}

// Items newest first, split into the date groups that have any.
export function groupByDate<T>(items: T[], at: (item: T) => number): { label: Group; items: T[] }[] {
	const sorted = [...items].sort((a, b) => at(b) - at(a));
	return GROUPS.map((label) => ({ label, items: sorted.filter((i) => groupOf(at(i)) === label) })).filter(
		(g) => g.items.length
	);
}

// A time today or yesterday, a short date before that.
export function when(at: number): string {
	if (!at) return '';
	const g = groupOf(at);
	const d = new Date(at);
	return g === 'Today' || g === 'Yesterday'
		? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		: d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const longDate = (at: number) =>
	at ? new Date(at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '';

export function split(p: string): { name: string; dir: string } {
	const i = p.lastIndexOf('/');
	return { name: p.slice(i + 1), dir: i < 0 ? '' : p.slice(0, i) };
}

export const kindIcon = (path: string, isDir: boolean) =>
	isDir ? 'folder' : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path) ? 'image' : 'description';
