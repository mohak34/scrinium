import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchNotes, listRecentNotes, type SearchScope } from '$lib/server/db';
import { ensureIndex } from '$lib/server/indexer';
import { listBin } from '$lib/server/vault';

const SCOPES: SearchScope[] = ['vault', 'archive', 'all'];

// ?scope=archive searches only archived notes, ?scope=all both; archived
// hits carry their ".archive/..." path. Plain search leaves the archive out.
// ?folder= keeps hits inside one folder, archived ones by their original path.
export const GET: RequestHandler = async ({ url }) => {
	await ensureIndex();
	const q = (url.searchParams.get('q') ?? '').trim();
	const scope = SCOPES.find((s) => s === url.searchParams.get('scope')) ?? 'vault';
	const folder = url.searchParams.get('folder')?.replace(/^\/+|\/+$/g, '') || undefined;
	if (!q) {
		return json(scope === 'archive' ? [] : listRecentNotes(15, folder));
	}
	if (q.length < 2) return json([]);
	return json(searchNotes(q, scope, folder ? await searchFolders(folder, scope) : undefined));
};

// The folder plus, when the archive is searched, where its archived notes
// sit: an archived item inside it, or the folder inside an archived one.
async function searchFolders(folder: string, scope: SearchScope): Promise<string[]> {
	const out = scope === 'archive' ? [] : [folder];
	if (scope === 'vault') return out;
	for (const e of await listBin('archive')) {
		const o = e.originalPath;
		if (o === folder || o.startsWith(`${folder}/`)) out.push(`.archive/${e.name}`);
		else if (e.isDir && folder.startsWith(`${o}/`)) out.push(`.archive/${e.name}${folder.slice(o.length)}`);
	}
	return out;
}
