// Shared by the archive routes, MCP and the archive page.

export interface ArchiveEntry {
	// Item name inside the archive folder, "<stamp>-<basename>".
	name: string;
	originalPath: string;
	archivedAt: number;
	isDir: boolean;
	// The item's notes by their original paths (a folder lists every .md
	// inside it), so links to them and search hits map back to the item.
	notes: string[];
}

// Where an archived note sits in the vault: ".archive/<name>[/<inside>]".
export function archivedNotePath(e: ArchiveEntry, note: string): string {
	return `.archive/${e.name}${note.slice(e.originalPath.length)}`;
}

// The entry and original path of an ".archive/..." vault path, or null.
export function fromArchivedPath(
	entries: ArchiveEntry[],
	path: string
): { entry: ArchiveEntry; note: string } | null {
	const m = /^\.archive\/([^/]+)(.*)$/.exec(path);
	const entry = m && entries.find((e) => e.name === m[1]);
	return entry ? { entry, note: entry.originalPath + m[2] } : null;
}

// A stale note from /api/archive/review.
export interface ReviewNote {
	path: string;
	title: string;
	updatedAt: number;
	// Words in the body, title heading and properties left out.
	words: number;
}
