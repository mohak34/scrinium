import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import { binPath, listBin, safeResolve } from '$lib/server/vault';
import { moveIn } from '$lib/server/bins';
import type { ArchiveEntry } from '$lib/archive';

async function notesUnder(rel: string, original: string, out: string[]): Promise<void> {
	for (const d of await fs.readdir(safeResolve(rel), { withFileTypes: true }).catch(() => [])) {
		if (d.name.startsWith('.')) continue;
		if (d.isDirectory()) await notesUnder(`${rel}/${d.name}`, `${original}/${d.name}`, out);
		else if (d.name.endsWith('.md')) out.push(`${original}/${d.name}`);
	}
}

export const GET: RequestHandler = async () => {
	const entries = await listBin('archive');
	const out: ArchiveEntry[] = [];
	for (const e of entries) {
		const notes: string[] = [];
		if (e.isDir) await notesUnder(binPath('archive', e.name), e.originalPath, notes);
		else if (e.originalPath.endsWith('.md')) notes.push(e.originalPath);
		out.push({ name: e.name, originalPath: e.originalPath, archivedAt: e.movedAt, isDir: e.isDir, notes });
	}
	return json(out);
};

// Archive a vault note or folder: { path }.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.path !== 'string' || !body.path) throw error(400, 'Missing path');
	const e = await moveIn('archive', body.path);
	return json({ name: e.name, originalPath: e.originalPath, archivedAt: e.movedAt, isDir: e.isDir });
};
