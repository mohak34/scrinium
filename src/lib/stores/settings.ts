import { writable } from 'svelte/store';

export interface EditorSettings {
	fontSize: number; // px
	showLineNumbers: boolean;
	wordWrap: boolean;
}

// Where pasted images land, Obsidian-style:
// - 'vault':  attachments/ in the vault root (the historical default)
// - 'note':   same folder as the note being edited
// - 'subfolder': an "assets" subfolder next to the note
// - 'root':   vault root itself
// - 'custom': a fixed folder inside the vault root (attachmentFolder)
export type AttachmentLocation = 'vault' | 'note' | 'subfolder' | 'root' | 'custom';

export interface AttachmentSettings {
	location: AttachmentLocation;
	folder: string; // only used when location === 'custom'
}

export interface Settings {
	editor: EditorSettings;
	attachments: AttachmentSettings;
}

export const DEFAULT_SETTINGS: Settings = {
	editor: {
		fontSize: 15,
		showLineNumbers: true,
		wordWrap: true
	},
	attachments: {
		location: 'vault',
		folder: ''
	}
};

const STORAGE_KEY = 'scrinium:settings';
export const SUBFOLDER_NAME = 'assets';

function loadAttachmentLocation(v: unknown): AttachmentLocation {
	return v === 'note' || v === 'subfolder' || v === 'root' || v === 'custom'
		? v
		: 'vault';
}

function loadCustomFolder(v: unknown): string {
	if (typeof v !== 'string') return DEFAULT_SETTINGS.attachments.folder;
	// Same rules the server enforces; keep the stored value sane.
	const segs = v.split('/').filter(Boolean);
	if (!segs.length || segs.some((s) => s.startsWith('.') || /[\\:*?"<>|]/.test(s))) return '';
	return segs.join('/');
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
						: DEFAULT_SETTINGS.editor.wordWrap
			},
			attachments: {
				location: loadAttachmentLocation(parsed.attachments?.location),
				folder: loadCustomFolder(parsed.attachments?.folder)
			}
		};
	} catch {
		return DEFAULT_SETTINGS;
	}
}

// Resolve where an attachment for a note in noteDir should go, as a vault-
// relative directory ('' means vault root). Shared by the editor uploader.
export function attachmentDirFor(
	noteDir: string | null,
	att: AttachmentSettings
): string {
	switch (att.location) {
		case 'root':
			return '';
		case 'custom':
			return att.folder;
		case 'note':
			return noteDir ?? '';
		case 'subfolder':
			return noteDir ? `${noteDir}/${SUBFOLDER_NAME}` : SUBFOLDER_NAME;
		case 'vault':
		default:
			return 'attachments';
	}
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
