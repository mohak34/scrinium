import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { restoreFromTrash, isFolder } from '$lib/server/vault';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { upsertNoteMeta, indexNote, moveTrashedProjects } from '$lib/server/db';
import { effectiveTitle } from '$lib/editor/frontmatter';

const VAULT_DIR = path.resolve(env.VAULT_DIR || './vault');

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const trashName = typeof body?.trashName === 'string' ? body.trashName : '';
	if (!trashName) throw error(400, 'Missing trashName');
	const restored = await restoreFromTrash(trashName);
	const restoredRel = restored.path;
	// Landed under a new name: projects that lived in the trashed folder follow it.
	if (restored.path !== restored.originalPath && restored.deletedAt != null) {
		moveTrashedProjects(restored.originalPath, restored.path, restored.deletedAt, isFolder);
	}

	// Re-index restored files so search/sidebar pick them up without waiting for next save.
	async function reindexRecursive(rel: string) {
		const full = path.join(VAULT_DIR, rel);
		try {
			const st = await fs.stat(full);
			if (st.isDirectory()) {
				const dirents = await fs.readdir(full, { withFileTypes: true });
				for (const d of dirents) {
					if (d.name.startsWith('.')) continue;
					await reindexRecursive(path.join(rel, d.name));
				}
			} else if (rel.endsWith('.md')) {
				try {
					const content = await fs.readFile(full, 'utf-8');
					const title = effectiveTitle(content, rel);
					upsertNoteMeta(rel, title, Date.now());
					indexNote(rel, title, content);
				} catch {}
			}
		} catch {}
	}
	await reindexRecursive(restoredRel);

	return json({ ok: true, path: restoredRel });
};
