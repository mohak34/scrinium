import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProjects, getProject, insertProject, deleteProject, setProjectStyle } from '$lib/server/db';
import { isProjectColor, isProjectIcon } from '$lib/projects';
import { createFolder } from '$lib/server/vault';

// Projects are vault folders, addressed by path in the body (POST) or
// ?path= (PATCH, DELETE), since paths carry slashes. Only a new project's path is
// cleaned; an existing one is addressed by its stored path exactly, which a
// folder rename may have set to anything the vault accepts.

// A new project is one folder at the vault root ("Jobs"), so the sidebar
// can give it its own section. Hidden names are refused so a project can't
// live in the trash or archive.
function cleanPath(v: unknown): string {
	if (typeof v !== 'string') throw error(400, 'Bad path');
	const parts = v.split('/').map((p) => p.trim()).filter(Boolean);
	if (parts.length !== 1) throw error(400, 'A project is a folder at the vault root');
	const path = parts[0];
	if (path.startsWith('.') || path.length > 200) throw error(400, 'Bad path');
	return path;
}

export const GET: RequestHandler = async () => json(listProjects());

// Registers a folder as a project, creating the folder when it is missing.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const path = cleanPath(body?.path);
	if (getProject(path)) throw error(409, 'Already a project');
	await createFolder(path);
	const row = insertProject(path);
	if (!row) throw error(409, 'Already a project');
	return json(row, { status: 201 });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path') ?? '';
	if (!getProject(path)) throw error(404, 'Project not found');
	deleteProject(path);
	return json({ ok: true });
};

// Sets the sidebar icon and/or color.
export const PATCH: RequestHandler = async ({ url, request }) => {
	const path = url.searchParams.get('path') ?? '';
	if (!getProject(path)) throw error(404, 'Project not found');
	const body = await request.json().catch(() => null);
	const { icon, color } = body ?? {};
	if (icon !== undefined && !isProjectIcon(icon)) throw error(400, 'Bad icon');
	if (color !== undefined && !isProjectColor(color)) throw error(400, 'Bad color');
	return json(setProjectStyle(path, { icon, color }));
};
