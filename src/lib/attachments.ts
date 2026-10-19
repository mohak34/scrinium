import { relativeTo } from './relink';

// Vault files that render as images: editor embeds, share pages, MCP reads.
// Shared by client and server so all three agree.
export const isImagePath = (p: string) => /\.(png|jpe?g|gif|webp|avif)$/i.test(p);

// The reference to put in a note for an uploaded file: an embed for images,
// a plain link for anything else.
export function attachmentMarkdown(vaultRel: string, notePath: string | null): string {
	// Markdown links resolve against the note's folder (see resolveAssetUrl);
	// uploads return vault-relative paths.
	const rel = notePath ? relativeTo(notePath.split('/').slice(0, -1).join('/'), vaultRel) : vaultRel;
	const file = vaultRel.split('/').pop() ?? vaultRel;
	return isImagePath(vaultRel) ? `![${file.replace(/\.[^.]+$/, '')}](${rel})` : `[${file}](${rel})`;
}
