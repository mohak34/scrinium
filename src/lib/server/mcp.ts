import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AREAS, PRIORITIES, STATUSES } from '$lib/taskModel';
import type { TaskRow } from './db';
import type { TrashEntry } from './vault';

// MCP tools for agents (Muse, Claude, ...). Every tool calls the app's own
// REST routes through SvelteKit's in-process fetch, so validation, search
// indexing, share/task-link rename tracking and the trash index stay in one
// place. The caller's Authorization header rides along on each call.
// onWrite fires after each successful change so the route can keep the
// agent activity log; read-only tools never call it.
type Fetch = typeof fetch;
export type OnWrite = (tool: string, target: string) => void;

const keys = <T extends readonly { key: string }[]>(list: T) =>
	list.map((x) => x.key) as [T[number]['key'], ...T[number]['key'][]];

const Status = z.enum(keys(STATUSES));
const Area = z.enum(keys(AREAS));
const Priority = z.enum(keys(PRIORITIES));
// Offsets are required: the server's clock zone is not the user's.
const When = z
	.string()
	.regex(/(Z|[+-]\d\d:?\d\d)$/, 'Needs a UTC offset, e.g. 2026-10-07T09:00-04:00')
	.refine((v) => !Number.isNaN(Date.parse(v)), 'Not a date')
	.describe('ISO 8601 with offset, e.g. 2026-10-07T09:00-04:00');
const NotePath = z
	.string()
	.min(1)
	.refine((p) => !p.split('/').includes('..'), 'Paths stay inside the vault')
	.describe('Vault-relative path, e.g. "College/DSA/Lecture 3.md"');

const INSTRUCTIONS = `Scrinium is a personal notes and tasks app. Notes are markdown files in a vault, addressed by vault-relative path ending in .md. The first "# " heading of a note is its title and should match the filename. Use [[Note name]] to link notes and #tag for tags.

Tasks are separate from notes. Status: ${STATUSES.map((s) => `${s.key} (${s.hint})`).join(', ')}. Areas: ${AREAS.map((a) => a.key).join(', ')}. Priorities: ${PRIORITIES.map((p) => p.key).join(', ')}. A task with parent_id is a subtask. Tasks can link to notes.

Dates are ISO 8601 with a UTC offset. An all-day due date is midnight in the user's local time, e.g. 2026-10-07T00:00:00-04:00. Timestamps in results are UTC.

For "what is on today" questions call get_agenda once. Before creating a task, search with list_tasks(query) to avoid duplicates. delete_note moves notes to the trash, where restore_from_trash can bring them back.`;

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
const ms = (v: string | null | undefined) => (v == null ? v : Date.parse(v));

// Agent-facing task shape: readable timestamps, no UI-only columns.
function taskOut(t: TaskRow) {
	return {
		id: t.id,
		title: t.title,
		detail: t.detail,
		status: t.status,
		priority: t.priority,
		area: t.area,
		parent_id: t.parent_id,
		due: iso(t.due_at),
		remind_at: iso(t.remind_at),
		waiting_on: t.waiting_on,
		waiting_since: iso(t.waiting_since),
		linked_notes: t.link_count,
		created: iso(t.created_at),
		updated: iso(t.updated_at)
	};
}

const result = (data: unknown) => ({
	content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
});

const enc = (p: string) => p.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');

export function createMcpServer(fetch: Fetch, origin: string, onWrite: OnWrite = () => {}) {
	// Throws the route's error message so the SDK reports it as a tool error.
	async function call(path: string, init?: RequestInit & { body?: string }): Promise<Response> {
		const res = await fetch(path, {
			...init,
			headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined
		});
		if (!res.ok) {
			const raw = await res.text();
			let msg = raw;
			try {
				msg = JSON.parse(raw).message ?? raw;
			} catch {}
			throw new Error(`${res.status}: ${msg}`);
		}
		return res;
	}
	const getJson = async <T>(path: string, init?: RequestInit & { body?: string }) =>
		(await (await call(path, init)).json()) as T;
	const send = (method: string, path: string, body?: unknown) =>
		call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
	const exists = async (path: string) => (await fetch(`/api/notes/${enc(path)}`)).ok;
	const readNote = async (path: string) => (await call(`/api/notes/${enc(path)}`)).text();
	const writeNote = (path: string, content: string) =>
		call(`/api/notes/${enc(path)}`, { method: 'PUT', body: content });
	const allTasks = () => getJson<TaskRow[]>('/api/tasks');

	const server = new McpServer({ name: 'scrinium', version: '1.0.0' }, { instructions: INSTRUCTIONS });
	const readOnly = { readOnlyHint: true };

	// Notes

	server.registerTool(
		'list_notes',
		{
			description: 'List every markdown note in the vault with its last-modified time.',
			annotations: readOnly
		},
		async () => {
			const rows = await getJson<{ path: string; updatedAt: number }[]>('/api/notes/manifest');
			return result(rows.map((r) => ({ path: r.path, updated: iso(Math.round(r.updatedAt)) })));
		}
	);

	server.registerTool(
		'search_notes',
		{
			description:
				'Full-text search over note titles and bodies. Returns up to 30 notes with a snippet. An empty query returns recently edited notes.',
			inputSchema: { query: z.string() },
			annotations: readOnly
		},
		async ({ query }) => result(await getJson(`/api/search?q=${encodeURIComponent(query)}`))
	);

	server.registerTool(
		'read_note',
		{ description: 'Read a note as raw markdown.', inputSchema: { path: NotePath }, annotations: readOnly },
		async ({ path }) => result(await readNote(path))
	);

	server.registerTool(
		'create_note',
		{
			description:
				'Create a new note. Fails if the path already exists. Missing folders are created. Start the content with "# <title>" matching the filename.',
			inputSchema: { path: NotePath, content: z.string() }
		},
		async ({ path, content }) => {
			if (!path.endsWith('.md')) throw new Error('Note paths end in .md');
			if (await exists(path)) throw new Error(`${path} already exists. Use update_note or append_to_note.`);
			await writeNote(path, content);
			onWrite('create_note', path);
			return result(`Created ${path}`);
		}
	);

	server.registerTool(
		'update_note',
		{
			description: 'Replace the whole content of an existing note. Prefer edit_note or append_to_note for small changes.',
			inputSchema: { path: NotePath, content: z.string() },
			annotations: { destructiveHint: true }
		},
		async ({ path, content }) => {
			await readNote(path);
			await writeNote(path, content);
			onWrite('update_note', path);
			return result(`Updated ${path}`);
		}
	);

	server.registerTool(
		'edit_note',
		{
			description:
				'Replace one exact snippet of a note, e.g. "- [ ] Buy milk" with "- [x] Buy milk". old_text must appear exactly once.',
			inputSchema: { path: NotePath, old_text: z.string().min(1), new_text: z.string() }
		},
		async ({ path, old_text, new_text }) => {
			const content = await readNote(path);
			const count = content.split(old_text).length - 1;
			if (count !== 1) throw new Error(`old_text found ${count} times in ${path}; it must match exactly once.`);
			await writeNote(path, content.replace(old_text, () => new_text));
			onWrite('edit_note', path);
			return result(`Edited ${path}`);
		}
	);

	server.registerTool(
		'append_to_note',
		{
			description: 'Append markdown to the end of a note, creating the note if it does not exist.',
			inputSchema: { path: NotePath, text: z.string().min(1) }
		},
		async ({ path, text }) => {
			if (!path.endsWith('.md')) throw new Error('Note paths end in .md');
			const res = await fetch(`/api/notes/${enc(path)}`);
			const cur = res.ok ? await res.text() : '';
			const sep = cur === '' || cur.endsWith('\n') ? '' : '\n';
			await writeNote(path, cur + sep + text + (text.endsWith('\n') ? '' : '\n'));
			onWrite('append_to_note', path);
			return result(res.ok ? `Appended to ${path}` : `Created ${path}`);
		}
	);

	server.registerTool(
		'move_note',
		{
			description:
				'Rename or move a note or folder. Shares and task links follow it. Wikilinks in other notes are not rewritten.',
			inputSchema: { path: NotePath, new_path: NotePath }
		},
		async ({ path, new_path }) => {
			const to = new_path.replace(/^\/+/, '');
			const cut = to.lastIndexOf('/');
			if (cut > 0) await send('POST', `/api/notes/${enc(to.slice(0, cut))}`, { folder: true });
			await send('PATCH', `/api/notes/${enc(path)}`, { newPath: to });
			onWrite('move_note', `${path} -> ${to}`);
			return result(`Moved ${path} to ${new_path}`);
		}
	);

	server.registerTool(
		'create_folder',
		{ description: 'Create a folder (and any missing parents).', inputSchema: { path: NotePath } },
		async ({ path }) => {
			await send('POST', `/api/notes/${enc(path)}`, { folder: true });
			onWrite('create_folder', path);
			return result(`Created folder ${path}`);
		}
	);

	server.registerTool(
		'delete_note',
		{
			description: 'Move a note or folder to the trash. It can be restored with restore_from_trash.',
			inputSchema: { path: NotePath },
			annotations: { destructiveHint: true }
		},
		async ({ path }) => {
			await send('DELETE', `/api/notes/${enc(path)}`);
			onWrite('delete_note', path);
			return result(`Moved ${path} to trash`);
		}
	);

	server.registerTool(
		'list_trash',
		{ description: 'List trashed notes and folders, newest first.', annotations: readOnly },
		async () => {
			const rows = await getJson<TrashEntry[]>('/api/trash');
			return result(
				rows.map((r) => ({ trash_name: r.trashName, original_path: r.originalPath, deleted: iso(r.deletedAt || null) }))
			);
		}
	);

	server.registerTool(
		'restore_from_trash',
		{
			description: 'Restore a trashed item to its original path (or a free name next to it).',
			inputSchema: { trash_name: z.string().min(1).describe('trash_name from list_trash') }
		},
		async ({ trash_name }) => {
			const out = (await (await send('POST', '/api/trash/restore', { trashName: trash_name })).json()) as { path: string };
			onWrite('restore_from_trash', out.path);
			return result(out);
		}
	);

	server.registerTool(
		'list_tags',
		{ description: 'Every #tag in the vault with the number of notes carrying it.', annotations: readOnly },
		async () => result(await getJson('/api/tags'))
	);

	server.registerTool(
		'find_notes_by_tag',
		{
			description: 'Notes carrying a tag inline or in frontmatter. Nested tags match too: "course" finds "course/neural".',
			inputSchema: { tag: z.string().min(1) },
			annotations: readOnly
		},
		async ({ tag }) => result(await getJson(`/api/tagged?tag=${encodeURIComponent(tag)}`))
	);

	server.registerTool(
		'get_backlinks',
		{
			description: 'Notes that link to this note with [[...]], plus notes that mention its title without linking.',
			inputSchema: { path: NotePath },
			annotations: readOnly
		},
		async ({ path }) => result(await getJson(`/api/backlinks?note=${encodeURIComponent(path)}`))
	);

	server.registerTool(
		'share_note',
		{
			description:
				'Create a public read-only link to a note. Anyone with the link can read it. Only call this when the user asks to share.',
			inputSchema: { path: NotePath, password: z.string().min(4).max(200).optional() }
		},
		async ({ path, password }) => {
			const share = (await (await send('POST', '/api/shares', { path, password })).json()) as { id: string };
			onWrite('share_note', path);
			return result({ url: `${origin}/s/${share.id}`, password_protected: !!password });
		}
	);

	// Tasks

	server.registerTool(
		'list_tasks',
		{
			description:
				'List tasks, open ones by default. Filters combine. query matches title and detail, case-insensitive.',
			inputSchema: {
				query: z.string().optional(),
				status: Status.optional(),
				area: Area.optional(),
				note_path: NotePath.optional().describe('Only tasks linked to this note'),
				parent_id: z.string().optional().describe('Only subtasks of this task'),
				include_done: z.boolean().optional().describe('Include done tasks (default false, ignored when status is set)')
			},
			annotations: readOnly
		},
		async ({ query, status, area, note_path, parent_id, include_done }) => {
			let rows = note_path
				? await getJson<TaskRow[]>(`/api/tasks?note=${encodeURIComponent(note_path)}`)
				: await allTasks();
			const q = query?.trim().toLowerCase();
			rows = rows.filter(
				(t) =>
					(status ? t.status === status : include_done || t.status !== 'done') &&
					(!area || t.area === area) &&
					(!parent_id || t.parent_id === parent_id) &&
					(!q || t.title.toLowerCase().includes(q) || t.detail.toLowerCase().includes(q))
			);
			return result(rows.map(taskOut));
		}
	);

	server.registerTool(
		'get_task',
		{
			description: 'One task with its subtasks and linked note paths.',
			inputSchema: { id: z.string() },
			annotations: readOnly
		},
		async ({ id }) => {
			const rows = await allTasks();
			const task = rows.find((t) => t.id === id);
			if (!task) throw new Error(`404: Task ${id} not found`);
			const links = await getJson<string[]>(`/api/tasks/${encodeURIComponent(id)}/links`);
			return result({
				...taskOut(task),
				subtasks: rows.filter((t) => t.parent_id === id).map(taskOut),
				notes: links
			});
		}
	);

	const taskFields = {
		detail: z.string().max(4000).optional().describe('Markdown notes for the task'),
		status: Status.optional(),
		priority: Priority.optional(),
		area: Area.nullable().optional(),
		due: When.nullable().optional(),
		remind_at: When.nullable().optional().describe('When to show a reminder, independent of due'),
		waiting_on: z.string().max(120).nullable().optional().describe('Who a waiting task is blocked on'),
		parent_id: z.string().nullable().optional().describe('Make this a subtask of another task')
	};

	server.registerTool(
		'create_task',
		{
			description: 'Create a task or, with parent_id, a subtask. Status defaults to todo ("This week"); use inbox for unplanned captures.',
			inputSchema: {
				title: z.string().min(1).max(200),
				...taskFields,
				note_paths: z.array(NotePath).optional().describe('Notes to link this task to')
			}
		},
		async ({ title, due, remind_at, note_paths, ...rest }) => {
			const row = (await (
				await send('POST', '/api/tasks', { title, ...rest, due_at: ms(due), remind_at: ms(remind_at) })
			).json()) as TaskRow;
			for (const p of note_paths ?? []) await send('POST', `/api/tasks/${row.id}/links`, { note_path: p });
			onWrite('create_task', row.title);
			return result(taskOut({ ...row, link_count: note_paths?.length ?? 0 }));
		}
	);

	server.registerTool(
		'update_task',
		{
			description: 'Change a task. Only the given fields change; pass null to clear area, due, remind_at, waiting_on or parent_id.',
			inputSchema: { id: z.string(), title: z.string().min(1).max(200).optional(), ...taskFields }
		},
		async ({ id, due, remind_at, ...rest }) => {
			const patch: Record<string, unknown> = { ...rest };
			if (due !== undefined) patch.due_at = ms(due);
			if (remind_at !== undefined) patch.remind_at = ms(remind_at);
			const row = (await (await send('PATCH', `/api/tasks/${encodeURIComponent(id)}`, patch)).json()) as TaskRow;
			onWrite('update_task', row.title);
			return result(taskOut(row));
		}
	);

	server.registerTool(
		'delete_task',
		{
			description: 'Permanently delete a task and all its subtasks. To finish a task, set status done instead.',
			inputSchema: { id: z.string() },
			annotations: { destructiveHint: true }
		},
		async ({ id }) => {
			const task = (await allTasks()).find((t) => t.id === id);
			if (!task) throw new Error(`404: Task ${id} not found`);
			await send('DELETE', `/api/tasks/${encodeURIComponent(id)}`);
			onWrite('delete_task', task.title);
			return result(`Deleted task ${id}`);
		}
	);

	server.registerTool(
		'link_task_to_note',
		{ description: 'Link a task to a note.', inputSchema: { id: z.string(), note_path: NotePath } },
		async ({ id, note_path }) => {
			const links = await (await send('POST', `/api/tasks/${encodeURIComponent(id)}/links`, { note_path })).json();
			onWrite('link_task_to_note', note_path);
			return result(links);
		}
	);

	server.registerTool(
		'unlink_task_from_note',
		{ description: 'Remove a link between a task and a note.', inputSchema: { id: z.string(), note_path: NotePath } },
		async ({ id, note_path }) => {
			const links = await getJson(
				`/api/tasks/${encodeURIComponent(id)}/links?note_path=${encodeURIComponent(note_path)}`,
				{ method: 'DELETE' }
			);
			onWrite('unlink_task_from_note', note_path);
			return result(links);
		}
	);

	server.registerTool(
		'get_agenda',
		{
			description:
				'Everything open that matters now, in one call: overdue, due today, due in the next 7 days, in progress, waiting (with days waited) and the inbox. Done tasks are left out. Use it for "what is on my plate" questions.',
			inputSchema: {
				timezone: z
					.string()
					.refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC', 'Unknown time zone')
					.describe('The user\'s IANA time zone, e.g. "America/New_York". Decides what "today" is.')
			},
			annotations: readOnly
		},
		async ({ timezone }) => {
			// Compare calendar days in the user's zone: en-CA formats as YYYY-MM-DD.
			const dayOf = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(t);
			const now = Date.now();
			const today = dayOf(now);
			const weekEnd = dayOf(now + 7 * 86400000);
			const open = (await allTasks()).filter((t) => t.status !== 'done');
			const dated = open.filter((t) => t.due_at != null).sort((a, b) => a.due_at! - b.due_at!);
			const day = (t: TaskRow) => dayOf(t.due_at!);
			return result({
				today,
				timezone,
				overdue: dated.filter((t) => day(t) < today).map(taskOut),
				due_today: dated.filter((t) => day(t) === today).map(taskOut),
				next_7_days: dated.filter((t) => day(t) > today && day(t) <= weekEnd).map(taskOut),
				doing: open.filter((t) => t.status === 'doing').map(taskOut),
				waiting: open
					.filter((t) => t.status === 'waiting')
					.map((t) => ({
						...taskOut(t),
						days_waiting: t.waiting_since == null ? null : Math.floor((now - t.waiting_since) / 86400000)
					})),
				inbox: open.filter((t) => t.status === 'inbox').map(taskOut)
			});
		}
	);

	return server;
}
