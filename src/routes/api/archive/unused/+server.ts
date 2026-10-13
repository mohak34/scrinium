import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import { binPath, listBin, listTree, readNotesUnder, safeResolve, type VaultEntry } from '$lib/server/vault';
import { linkTargets } from '$lib/relink';
import type { UnusedFile } from '$lib/archive';

// Vault files (anything but notes) that no note links to: mostly images
// left behind when their note was trashed or the embed deleted. Archived
// notes count as links, read from where they came from, so unarchiving a
// note never brings it back with a missing image. A direct scan of the
// vault files, like review: nothing to keep in sync.
export const GET: RequestHandler = async () => {
	const linked = new Set<string>();
	for (const n of await readNotesUnder('')) for (const t of linkTargets(n.content, n.path)) linked.add(t);
	for (const e of await listBin('archive')) {
		const at = binPath('archive', e.name);
		for (const n of await readNotesUnder(at)) {
			const original = e.originalPath + n.path.slice(at.length);
			for (const t of linkTargets(n.content, original)) linked.add(t);
		}
	}

	const files: string[] = [];
	const walk = (entries: VaultEntry[]) => {
		for (const e of entries) {
			if (e.type === 'directory') walk(e.children ?? []);
			else if (!e.path.endsWith('.md') && !linked.has(e.path)) files.push(e.path);
		}
	};
	walk(await listTree());

	const out: UnusedFile[] = [];
	for (const path of files) {
		const st = await fs.stat(safeResolve(path)).catch(() => null);
		if (st) out.push({ path, size: st.size, modifiedAt: Math.round(st.mtimeMs) });
	}
	out.sort((a, b) => a.modifiedAt - b.modifiedAt);
	return json(out);
};
