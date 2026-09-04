import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import { safeResolve } from '$lib/server/vault';
import { findBacklinks } from '$lib/editor/wikilinks';

export interface Backlink {
	path: string;
	excerpt: string;
}

// Notes linking TO `?note=`. Vault files are the source of truth: walk
// the `.md` files, resolve every `[[...]]` like the editor does, keep the
// ones landing on the target. Personal-vault scale makes a direct scan
// cheaper than another index to keep in sync.
export const GET: RequestHandler = async ({ url }) => {
	const target = (url.searchParams.get('note') ?? '').trim();
	if (!target) throw error(400, 'Missing note');

	const paths: string[] = [];
	async function walk(relDir = ''): Promise<void> {
		let dirents;
		try {
			dirents = await fs.readdir(safeResolve(relDir), { withFileTypes: true });
		} catch {
			return;
		}
		for (const d of dirents) {
			if (d.name.startsWith('.')) continue;
			const rel = relDir ? `${relDir}/${d.name}` : d.name;
			if (d.isDirectory()) await walk(rel);
			else if (d.name.toLowerCase().endsWith('.md')) paths.push(rel);
		}
	}
	await walk();

	const files = await Promise.all(
		paths.map(async (p) => {
			try {
				return { path: p, content: await fs.readFile(safeResolve(p), 'utf-8') };
			} catch {
				return null;
			}
		})
	);
	const out: Backlink[] = findBacklinks(
		target,
		files.filter((f): f is { path: string; content: string } => f !== null)
	);
	return json(out);
};
