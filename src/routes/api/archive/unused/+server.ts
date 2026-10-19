import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import { binPath, listBin, listTree, readNotesUnder, safeResolve, type VaultEntry } from '$lib/server/vault';
import type { UnusedFile } from '$lib/archive';
import { unescapeMarkdown } from '$lib/relink';

// Vault files (anything but notes) that no note mentions: mostly images
// left behind when their note was trashed or the embed deleted. A file
// counts as used when any live or archived note contains its name anywhere
// (links, embeds, reference definitions, code), also once percent-encoding,
// markdown escapes and character references in the notes are undone.
// That keeps a few unused files on the list but never offers a referenced
// one for the trash. A direct scan of the vault, like review: nothing to
// keep in sync.
export const GET: RequestHandler = async () => {
	const texts = (await readNotesUnder('')).map((n) => n.content);
	for (const e of await listBin('archive')) {
		for (const n of await readNotesUnder(binPath('archive', e.name))) texts.push(n.content);
	}
	const raw = texts.join('\n');
	const plain = unescapeMarkdown(raw).replace(/(%[\da-f]{2})+/gi, (m) => {
		try {
			return decodeURIComponent(m);
		} catch {
			return m;
		}
	});

	const files: string[] = [];
	const walk = (entries: VaultEntry[]) => {
		for (const e of entries) {
			if (e.type === 'directory') walk(e.children ?? []);
			else if (!e.path.endsWith('.md') && !raw.includes(e.name) && !plain.includes(e.name)) files.push(e.path);
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

