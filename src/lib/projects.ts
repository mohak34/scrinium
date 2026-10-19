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
