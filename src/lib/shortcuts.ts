// Keyboard reference shared by the ? help overlay and Settings > Keyboard.
export interface ShortcutRow {
	keys: string;
	desc: string;
}

export const SHORTCUTS: { title: string; rows: ShortcutRow[] }[] = [
	{
		title: 'File tree',
		rows: [
			{ keys: 'j k / arrows', desc: 'Move between entries' },
			{ keys: 'l', desc: 'Expand folder / first child' },
			{ keys: 'h', desc: 'Collapse folder / parent folder' },
			{ keys: 'Enter', desc: 'Open note / toggle folder' }
		]
	},
	{
		title: 'Leader (Space, then a key)',
		rows: [
			{ keys: 'Space p', desc: 'Command palette' },
			{ keys: 'Space n / N', desc: 'New note / new folder' },
			{ keys: 'Space e', desc: 'Focus editor' },
			{ keys: 'Space f', desc: 'Focus note search' },
			{ keys: 'Space s / r', desc: 'Toggle left / right sidebar' },
			{ keys: 'Space x', desc: 'Close current tab' },
			{ keys: 'Space P', desc: 'Pin / unpin current note' }
		]
	},
	{
		title: 'General',
		rows: [
			{ keys: 'Ctrl/⌘ K', desc: 'Command palette' },
			{ keys: 'Ctrl/⌘ Shift 1-4', desc: 'Switch app' },
			{ keys: '/', desc: 'Focus note search' },
			{ keys: '?', desc: 'This help' },
			{ keys: 'Esc', desc: 'Close dialog' }
		]
	},
	{
		title: 'Tabs',
		rows: [
			{ keys: '[', desc: 'Previous tab' },
			{ keys: ']', desc: 'Next tab' }
		]
	},
	{
		title: 'Sidebar',
		rows: [{ keys: 'Ctrl/⌘ /', desc: 'Toggle sidebar' }]
	},
	{
		title: 'Editor',
		rows: [
			{ keys: 'Ctrl/⌘ F', desc: 'Find in note' },
			{ keys: 'Ctrl/⌘ B / I', desc: 'Bold / italic' },
			{ keys: 'Esc', desc: 'Normal mode, then full preview' }
		]
	},
	{
		title: 'Editor vim motions',
		rows: [
			{ keys: 'h j k l', desc: 'Move' },
			{ keys: 'i / a', desc: 'Insert before / after cursor' },
			{ keys: 'w b e', desc: 'Word forward / back / end' },
			{ keys: '0 $', desc: 'Line start / end' },
			{ keys: 'gg G', desc: 'Top / bottom of note' },
			{ keys: 'o O', desc: 'New line below / above' },
			{ keys: 'x dd', desc: 'Delete char / line' },
			{ keys: 'yy p', desc: 'Yank line / put' },
			{ keys: 'u', desc: 'Undo' },
			{ keys: 'v', desc: 'Visual mode' }
		]
	}
];
