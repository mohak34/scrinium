// Vault files that render as images: editor embeds, share pages, MCP reads.
// Shared by client and server so all three agree.
export const isImagePath = (p: string) => /\.(png|jpe?g|gif|webp|avif)$/i.test(p);

// Markdown links resolve against the note's folder (see resolveAssetUrl);
// uploads return vault-relative paths. Convert so nested notes don't get
// doubled paths.
function noteRelative(notePath: string, vaultRel: string): string {
	const from = notePath.split('/').slice(0, -1).filter(Boolean);
	const to = vaultRel.split('/').filter(Boolean);
	let i = 0;
	while (i < from.length && i < to.length && from[i] === to[i]) i++;
	return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/') || vaultRel;
}

// The reference to put in a note for an uploaded file: an embed for images,
// a plain link for anything else.
export function attachmentMarkdown(vaultRel: string, notePath: string | null): string {
	const rel = notePath ? noteRelative(notePath, vaultRel) : vaultRel;
	const file = vaultRel.split('/').pop() ?? vaultRel;
	return isImagePath(vaultRel) ? `![${file.replace(/\.[^.]+$/, '')}](${rel})` : `[${file}](${rel})`;
}
