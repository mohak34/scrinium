import { writable } from 'svelte/store';

export interface EditorSettings {
	fontSize: number; // px
	showLineNumbers: boolean;
	wordWrap: boolean;
}

export interface Settings {
	editor: EditorSettings;
}

export const DEFAULT_SETTINGS: Settings = {
	editor: {
		fontSize: 15,
		showLineNumbers: true,
		wordWrap: true
	}
};

const STORAGE_KEY = 'scrinium:settings';

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
			}
		};
	} catch {
		return DEFAULT_SETTINGS;
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
