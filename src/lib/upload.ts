import { encPath, loadTree } from '$lib/stores/vault';

// A file from the user's computer and its path under the folder it was
// dropped on ("notes/a.md" when it came inside a dropped "notes" folder).
export interface Upload {
	file: File;
	rel: string;
}

// The files of a drop, folders walked recursively. Entries have to be taken
// during the drop event, before anything awaits. Hidden files (.DS_Store,
// .git) are skipped.
export function filesFromDrop(dt: DataTransfer): Promise<Upload[]> {
	const entries = Array.from(dt.items, (i) => i.webkitGetAsEntry?.() ?? null);
	if (entries.some((e) => !e)) return Promise.resolve(Array.from(dt.files, (file) => ({ file, rel: file.name })));
	return walk(entries as FileSystemEntry[], '');
}

async function walk(entries: FileSystemEntry[], prefix: string): Promise<Upload[]> {
	const out: Upload[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue;
		const rel = prefix + entry.name;
		if (entry.isFile) {
			const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
			out.push({ file, rel });
		} else if (entry.isDirectory) {
			out.push(...(await walk(await readDir(entry as FileSystemDirectoryEntry), rel + '/')));
		}
	}
	return out;
}

// readEntries hands a directory out in batches until it returns none.
async function readDir(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
	const reader = dir.createReader();
	const all: FileSystemEntry[] = [];
	for (;;) {
		const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
		if (!batch.length) return all;
		all.push(...batch);
	}
}

// Uploads into a vault folder (null is the root), keeping dropped folders'
// structure. Notes go through the notes API so they are indexed, other files
// through /api/attachments; a name that is taken gets a number, nothing is
// replaced. Says which files failed.
export async function uploadFiles(dir: string | null, uploads: Upload[]) {
	const failed: string[] = [];
	for (const { file, rel } of uploads) {
		const parts = rel.split('/');
		const name = parts.pop()!;
		const folder = [dir, ...parts].filter(Boolean).join('/');
		const ok = /\.md$/i.test(name) ? await uploadNote(folder, name, file) : await uploadAsset(folder, name, file);
		if (!ok) failed.push(rel);
	}
	await loadTree();
	if (failed.length) alert(`Upload failed: ${failed.join(', ')}`);
}

async function uploadNote(folder: string, name: string, file: File): Promise<boolean> {
	const stem = name.replace(/\.md$/i, '');
	const content = await file.text();
	for (let n = 0; n < 100; n++) {
		const path = [folder, `${stem}${n ? `-${n}` : ''}.md`].filter(Boolean).join('/');
		const res = await fetch(`/api/notes/${encPath(path)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' },
			body: content
		}).catch(() => null);
		if (res?.status !== 409) return !!res?.ok;
	}
	return false;
}

async function uploadAsset(folder: string, name: string, file: File): Promise<boolean> {
	const query = new URLSearchParams({ name, folder });
	// Unknown types have file.type '' and would go out with no Content-Type,
	// which makes SvelteKit drop the body.
	const res = await fetch(`/api/attachments?${query}`, {
		method: 'POST',
		body: file,
		headers: { 'Content-Type': file.type || 'application/octet-stream' }
	}).catch(() => null);
	return !!res?.ok;
}
