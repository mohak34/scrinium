import fs from 'node:fs/promises';
import {
	binPath,
	isFolder,
	moveBetweenBins,
	moveToBin,
	restoreFromBin,
	safeResolve,
	vaultRel,
	type Bin,
	type BinEntry,
	type Restored
} from './vault';
import {
	deleteNoteIndexByPrefix,
	deleteNoteMetaByPrefix,
	indexNote,
	moveTrashedProjects,
	renameNoteIndex,
	renameTaskLinks,
	upsertNoteMeta
} from './db';
import { deleteSharesByPrefix } from './shares';
import { effectiveTitle } from '$lib/editor/frontmatter';

// The cache bookkeeping around moving notes in and out of the trash and
// archive. Routes call these, never the vault bin functions directly.
// Task links ride along to the bin path and back, so a restored note keeps
// its tasks; share links are dropped, since a public link to a note you put
// away is a surprise. Archived notes stay in the search index under their
// bin path; trashed ones leave it.

export async function moveIn(bin: Bin, relPath: string): Promise<BinEntry> {
	const rel = vaultRel(relPath);
	const entry = await moveToBin(bin, rel);
	const to = binPath(bin, entry.name);
	deleteNoteMetaByPrefix(rel);
	deleteSharesByPrefix(rel);
	renameTaskLinks(rel, to);
	if (bin === 'archive') renameNoteIndex(rel, to);
	else deleteNoteIndexByPrefix(rel);
	return entry;
}

export async function restore(bin: Bin, name: string): Promise<Restored> {
	const restored = await restoreFromBin(bin, name);
	const from = binPath(bin, name);
	renameTaskLinks(from, restored.path);
	deleteNoteIndexByPrefix(from);
	// Landed under a new name: projects that lived in the folder follow it.
	const [was, now] = [vaultRel(restored.originalPath), vaultRel(restored.path)];
	if (was !== now && restored.movedAt != null) moveTrashedProjects(was, now, restored.movedAt, isFolder);
	await reindex(restored.path);
	return restored;
}

export async function archiveToTrash(name: string): Promise<BinEntry> {
	const entry = await moveBetweenBins('archive', 'trash', name);
	const from = binPath('archive', name);
	renameTaskLinks(from, binPath('trash', entry.name));
	deleteNoteIndexByPrefix(from);
	return entry;
}

// Put a restored note or folder back in the sidebar cache and search index.
async function reindex(rel: string): Promise<void> {
	const full = safeResolve(rel);
	const st = await fs.stat(full).catch(() => null);
	if (st?.isDirectory()) {
		for (const d of await fs.readdir(full, { withFileTypes: true }).catch(() => [])) {
			if (!d.name.startsWith('.')) await reindex(`${rel}/${d.name}`);
		}
	} else if (st && rel.endsWith('.md')) {
		const content = await fs.readFile(full, 'utf-8').catch(() => null);
		if (content === null) return;
		const title = effectiveTitle(content, rel);
		upsertNoteMeta(rel, title, Date.now());
		indexNote(rel, title, content);
	}
}
