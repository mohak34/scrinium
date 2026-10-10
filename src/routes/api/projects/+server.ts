import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProjects, getProject, insertProject, setProjectArea, deleteProject } from '$lib/server/db';
import { createFolder } from '$lib/server/vault';
import { isArea } from '$lib/taskModel';

// Projects are vault folders, addressed by path in the body (POST, PATCH) or
// ?path= (DELETE), since paths carry slashes. Only a new project's path is
// cleaned; an existing one is addressed by its stored path exactly, which a
// folder rename may have set to anything the vault accepts.

// "Projects/scrinium" from whatever the user typed. Hidden segments are
// refused so a project can't live in .trash.
function cleanPath(v: unknown): string {
	if (typeof v !== 'string') throw error(400, 'Bad path');
	const parts = v.split('/').map((p) => p.trim()).filter(Boolean);
	if (parts.length === 0 || parts.some((p) => p.startsWith('.'))) throw error(400, 'Bad path');
	const path = parts.join('/');
	if (path.length > 200) throw error(400, 'Bad path');
	return path;
}

function cleanArea(v: unknown) {
	if (v == null) return null;
	if (!isArea(v)) throw error(400, 'Bad area');
	return v;
}

export const GET: RequestHandler = async () => json(listProjects());

// Registers a folder as a project, creating the folder when it is missing.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const path = cleanPath(body?.path);
	const area = cleanArea(body?.area);
	if (getProject(path)) throw error(409, 'Already a project');
	await createFolder(path);
	const row = insertProject(path, area);
	if (!row) throw error(409, 'Already a project');
	return json(row, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.path !== 'string') throw error(400, 'Bad path');
	const row = setProjectArea(body.path, cleanArea(body?.area));
	if (!row) throw error(404, 'Project not found');
	return json(row);
};

export const DELETE: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path') ?? '';
	if (!getProject(path)) throw error(404, 'Project not found');
	deleteProject(path);
	return json({ ok: true });
};
