import { writable } from 'svelte/store';
import { projectOf } from '$lib/projects';

export interface EditorSettings {
	fontSize: number; // px
	showLineNumbers: boolean;
	wordWrap: boolean;
	// Vim-style keyboard navigation: single-key shortcuts that only fire
	// outside text inputs, so they never clash with browser bindings.
	vimMotions: boolean;
}

// Pasted and dropped files land in `folder` under a base directory:
// - 'project': the note's project folder, or the vault root for a Quotidian note
// - 'vault':   the vault root
// - 'note':    the note's own folder
// An empty folder means the base itself.
export type AttachmentBase = 'project' | 'vault' | 'note';

export interface AttachmentSettings {
	base: AttachmentBase;
	folder: string;
}

export interface Settings {
	editor: EditorSettings;
	attachments: AttachmentSettings;
}

export const DEFAULT_SETTINGS: Settings = {
	editor: {
		fontSize: 17,
		showLineNumbers: true,
		wordWrap: true,
		vimMotions: true
	},
	attachments: {
		base: 'project',
		folder: 'attachments'
	}
};

const STORAGE_KEY = 'scrinium:settings';

// A vault-relative folder ('' for none), or null if it breaks the rules the
// server enforces.
export function cleanFolder(v: string): string | null {
	const segs = v.split('/').map((p) => p.trim()).filter(Boolean);
	return segs.some((s) => s.startsWith('.') || /[\\:*?"<>|]/.test(s)) ? null : segs.join('/');
}

// Settings stored before `base` existed carry `location` and `name`; map them
// onto base + folder.
function loadAttachments(v: unknown): AttachmentSettings {
	const d = DEFAULT_SETTINGS.attachments;
	if (!v || typeof v !== 'object') return d;
	const o = v as Record<string, unknown>;
	const str = (x: unknown) => (typeof x === 'string' ? cleanFolder(x) : null);
	if (o.base === 'project' || o.base === 'vault' || o.base === 'note') {
		return { base: o.base, folder: str(o.folder) ?? d.folder };
	}
	const name = str(o.name) || d.folder;
	switch (o.location) {
		case 'root':
			return { base: 'vault', folder: '' };
		case 'custom':
			return { base: 'vault', folder: str(o.folder) ?? '' };
		case 'note':
			return { base: 'note', folder: '' };
		case 'subfolder':
			return { base: 'note', folder: name };
		default:
			return { base: 'project', folder: name };
	}
}

function loadSettings(): Settings {
	// window check (not localStorage) so SSR never even touches the global.
	if (typeof window === 'undefined') return DEFAULT_SETTINGS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_SETTINGS;
		const parsed = JSON.parse(raw) as Partial<Settings>;
		return {
			editor: {
				fontSize:
					typeof parsed.editor?.fontSize === 'number' &&
					parsed.editor.fontSize >= 10 &&
					parsed.editor.fontSize <= 24
						? parsed.editor.fontSize
						: DEFAULT_SETTINGS.editor.fontSize,
				showLineNumbers:
					typeof parsed.editor?.showLineNumbers === 'boolean'
						? parsed.editor.showLineNumbers
						: DEFAULT_SETTINGS.editor.showLineNumbers,
				wordWrap:
					typeof parsed.editor?.wordWrap === 'boolean'
						? parsed.editor.wordWrap
						: DEFAULT_SETTINGS.editor.wordWrap,
				vimMotions:
					typeof parsed.editor?.vimMotions === 'boolean'
						? parsed.editor.vimMotions
						: DEFAULT_SETTINGS.editor.vimMotions
			},
			attachments: loadAttachments(parsed.attachments)
		};
	} catch {
		return DEFAULT_SETTINGS;
	}
}

// The vault-relative folder ('' for the vault root) an attachment pasted
// into notePath goes to.
export function attachmentDirFor(
	notePath: string | null,
	att: AttachmentSettings,
	projects: ReadonlySet<string>
): string {
	const base =
		!notePath || att.base === 'vault'
			? ''
			: att.base === 'note'
				? notePath.split('/').slice(0, -1).join('/')
				: (projectOf(notePath, projects) ?? '');
	return [base, att.folder].filter(Boolean).join('/');
}

function createSettingsStore() {
	const initial = typeof window !== 'undefined' ? loadSettings() : DEFAULT_SETTINGS;
	const store = writable<Settings>(initial);

	if (typeof window !== 'undefined') {
		store.subscribe((value) => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
			} catch {
				// storage full/blocked
			}
		});
	}

	return {
		subscribe: store.subscribe,
		set: store.set,
		update: store.update,
		reset() {
			store.set(DEFAULT_SETTINGS);
		}
	};
}

export const settings = createSettingsStore();
