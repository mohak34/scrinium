// The four apps behind the top-left switcher, in shortcut order:
// Ctrl+Shift+1..4 jumps to them from anywhere.
export const APPS = [
	{ key: 'notes', label: 'Notes', icon: 'description', href: '/' },
	{ key: 'tasks', label: 'Tasks', icon: 'task_alt', href: '/tasks' },
	{ key: 'board', label: 'Board', icon: 'view_kanban', href: '/tasks/kanban' },
	{ key: 'calendar', label: 'Calendar', icon: 'calendar_month', href: '/tasks/calendar' }
] as const;

export type AppKey = (typeof APPS)[number]['key'];

export function appForPath(pathname: string): AppKey {
	if (pathname.startsWith('/tasks/kanban')) return 'board';
	if (pathname.startsWith('/tasks/calendar')) return 'calendar';
	if (pathname.startsWith('/tasks')) return 'tasks';
	return 'notes';
}
