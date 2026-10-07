import { writable } from 'svelte/store';

// The settings dialog (root layout) is open on this page, or closed when
// null. Sidebar buttons and palette commands open it; trash is one page.
export type SettingsPage =
	| 'editor'
	| 'keyboard'
	| 'attachments'
	| 'account'
	| 'devices'
	| 'agents'
	| 'trash'
	| 'about';

export const settingsPage = writable<SettingsPage | null>(null);

export const openSettings = (page: SettingsPage = 'editor') => settingsPage.set(page);
