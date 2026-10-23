// Projects split the vault: each project is a folder at the vault root, and
// Quotidian is everything outside one. The notes sidebar and the board show
// every project at once ('all') or a single one.

// A project's folder path, or null for Quotidian. Tasks use the same key in
// their `project` column.
export type ProjectKey = string | null;
export type ProjectView = 'all' | { project: ProjectKey };

export const QUOTIDIAN = 'Quotidian';

export const projectLabel = (key: ProjectKey) => key ?? QUOTIDIAN;

// The project a vault path belongs to: its top-level folder when that folder
// is a project, otherwise Quotidian.
export function projectOf(path: string, projects: ReadonlySet<string>): ProjectKey {
	const top = path.split('/')[0];
	return path.includes('/') && projects.has(top) ? top : null;
}

// The board for a view. Quotidian is an empty ?project=, All has none.
export function boardHref(view: ProjectView): string {
	if (view === 'all') return '/tasks/kanban';
	return `/tasks/kanban?project=${encodeURIComponent(view.project ?? '')}`;
}

// A project's icon and color in the sidebar, picked from these. Quotidian
// has no row and always shows as home in gray.
export const PROJECT_ICONS = [
	'deployed_code', 'school', 'work', 'menu_book', 'science', 'code', 'fitness_center', 'savings',
	'flight', 'home', 'psychology', 'rocket_launch', 'music_note', 'palette', 'sports_esports', 'favorite'
] as const;
export const PROJECT_COLORS = ['gray', 'teal', 'blue', 'green', 'rose', 'violet', 'orange', 'yellow', 'sand'] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const colorVar = (c: ProjectColor) =>
	c === 'gray' ? 'var(--text-2)' : c === 'teal' ? 'var(--accent)' : `var(--${c})`;

export const isProjectIcon = (v: unknown): v is ProjectIcon => PROJECT_ICONS.includes(v as ProjectIcon);
export const isProjectColor = (v: unknown): v is ProjectColor => PROJECT_COLORS.includes(v as ProjectColor);

// An unpicked color comes from the path, so each project starts out different
// and keeps its color across reloads.
export function projectStyle(
	key: ProjectKey,
	row?: { icon: string | null; color: string | null }
): { icon: ProjectIcon; color: ProjectColor } {
	if (key === null) return { icon: 'home', color: 'gray' };
	let h = 0;
	for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return {
		icon: isProjectIcon(row?.icon) ? row.icon : 'deployed_code',
		color: isProjectColor(row?.color) ? row.color : PROJECT_COLORS[1 + (h % (PROJECT_COLORS.length - 1))]
	};
}
