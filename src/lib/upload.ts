import { encPath, loadTree } from '$lib/stores/vault';
import { retitle } from '$lib/editor/frontmatter';
import { relinkNote } from '$lib/relink';

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
// replaced. Files go first, so the notes' links to any the server renamed
// (`my plot.png` lands as `my-plot.png`) can be fixed before they upload.
// Says which files failed.
export async function uploadFiles(dir: string | null, uploads: Upload[]) {
	const failed: string[] = [];
	const renamed = new Map<string, string>();
	const isNote = (u: Upload) => /\.md$/i.test(u.rel);
	for (const { file, rel } of [...uploads.filter((u) => !isNote(u)), ...uploads.filter(isNote)]) {
		const parts = rel.split('/');
		const name = parts.pop()!;
		const folder = [dir, ...parts].filter(Boolean).join('/');
		const asked = [folder, name].filter(Boolean).join('/');
		if (/\.md$/i.test(name)) {
			const content = relinkNote(await file.text(), asked, asked, (p) => renamed.get(p) ?? p);
			if (!(await uploadNote(folder, name, content))) failed.push(rel);
			continue;
		}
		const path = await uploadAsset(folder, name, file);
		if (path === null) failed.push(rel);
		else if (path !== asked) renamed.set(asked, path);
	}
	await loadTree();
	if (failed.length) alert(`Upload failed: ${failed.join(', ')}`);
}

async function uploadNote(folder: string, name: string, content: string): Promise<boolean> {
	const stem = name.replace(/\.md$/i, '');
	for (let n = 0; n < 100; n++) {
		const path = [folder, `${stem}${n ? `-${n}` : ''}.md`].filter(Boolean).join('/');
		// A numbered copy is retitled after its filename, or title sync would
		// try to rename it back onto the taken name.
		const res = await fetch(`/api/notes/${encPath(path)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' },
			body: retitle(content, name, path)
		}).catch(() => null);
		if (res?.status !== 409) return !!res?.ok;
	}
	return false;
}

// Where the file landed, or null when the upload failed.
async function uploadAsset(folder: string, name: string, file: File): Promise<string | null> {
	const query = new URLSearchParams({ name, folder });
	// Unknown types have file.type '' and would go out with no Content-Type,
	// which makes SvelteKit drop the body.
	const res = await fetch(`/api/attachments?${query}`, {
		method: 'POST',
		body: file,
		headers: { 'Content-Type': file.type || 'application/octet-stream' }
	}).catch(() => null);
	if (!res?.ok) return null;
	const data: { path?: unknown } = await res.json().catch(() => ({}));
	return typeof data.path === 'string' ? data.path : null;
}
