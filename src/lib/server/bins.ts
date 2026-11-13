import {
	binPath,
	isFolder,
	moveBetweenBins,
	moveToBin,
	restoreFromBin,
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
	upsertNoteMeta,
	history
} from './db';
import { deleteSharesByPrefix } from './shares';
import { effectiveTitle } from '$lib/editor/frontmatter';

// The cache bookkeeping around moving notes in and out of the trash and
// archive. Routes call these, never the vault bin functions directly.
// Task links and note history ride along to the bin path and back, so a
// restored note keeps its tasks and past versions; share links are dropped, since a public link to a note you put
// away is a surprise. Archived notes stay in the search index under their
// bin path; trashed ones leave it.

// [version]: trash only that text of the note (see moveToBin).
export async function moveIn(bin: Bin, relPath: string, version?: string): Promise<BinEntry> {
	const rel = vaultRel(relPath);
	const entry = await moveToBin(bin, rel, version);
	const to = binPath(bin, entry.name);
	deleteNoteMetaByPrefix(rel);
	deleteSharesByPrefix(rel);
	renameTaskLinks(rel, to);
	history.rename(rel, to);
	if (bin === 'archive') renameNoteIndex(rel, to);
	else deleteNoteIndexByPrefix(rel);
	return entry;
}

export async function restore(bin: Bin, name: string): Promise<Restored> {
	const restored = await restoreFromBin(bin, name);
	const from = binPath(bin, name);
	renameTaskLinks(from, restored.path);
	history.rename(from, vaultRel(restored.path));
	deleteNoteIndexByPrefix(from);
	// Landed under a new name: projects that lived in the folder follow it.
	const [was, now] = [vaultRel(restored.originalPath), vaultRel(restored.path)];
	if (was !== now && restored.movedAt != null) moveTrashedProjects(was, now, restored.movedAt, isFolder);
	// Put the notes back in the sidebar cache and search index. No await
	// since the move: a later archive of the same note books after this.
	for (const n of restored.notes) {
		const title = effectiveTitle(n.content, n.path);
		upsertNoteMeta(n.path, title, Date.now());
		indexNote(n.path, title, n.content);
	}
	return restored;
}

export async function archiveToTrash(name: string): Promise<BinEntry> {
	const entry = await moveBetweenBins('archive', 'trash', name);
	const from = binPath('archive', name);
	renameTaskLinks(from, binPath('trash', entry.name));
	history.rename(from, binPath('trash', entry.name));
	deleteNoteIndexByPrefix(from);
	return entry;
}
