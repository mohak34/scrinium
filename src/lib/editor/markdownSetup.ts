import { markdown, markdownLanguage as gfm } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';

// Base visual theme. Kept deliberately plain - no syntax-highlighting
// rainbow soup, just enough contrast to read comfortably.
export const baseTheme = EditorView.theme(
	{
		'&': {
			height: '100%',
			fontSize: '15px',
			backgroundColor: '#14151a',
			color: '#e6e6e6'
		},
		'.cm-content': {
			fontFamily: "'iA Writer Quattro', 'Inter', system-ui, sans-serif",
			padding: '2rem 3rem',
			maxWidth: '780px',
			margin: '0 auto',
			lineHeight: '1.65'
		},
		'.cm-line': { padding: '0 2px' },
		'&.cm-focused': { outline: 'none' },
		'.cm-gutters': {
			backgroundColor: '#14151a',
			color: '#3f424d',
			border: 'none',
			fontSize: '0.75rem',
			userSelect: 'none'
		},
		'.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem 0 0.75rem', minWidth: '1rem' },
		'.cm-cursor': { borderLeftColor: '#e6e6e6' },
		'.cm-selectionBackground': { backgroundColor: '#2c3550 !important' },

		'.cm-heading-1': { fontSize: '1.7em', fontWeight: '700' },
		'.cm-heading-2': { fontSize: '1.4em', fontWeight: '700' },
		'.cm-heading-3': { fontSize: '1.2em', fontWeight: '600' },
		'.cm-heading-4': { fontSize: '1.05em', fontWeight: '600' },
		'.cm-heading-5': { fontSize: '0.95em', fontWeight: '600', color: '#aeb1bc' },
		'.cm-heading-6': {
			fontSize: '0.85em',
			fontWeight: '600',
			color: '#8b8e99',
			textTransform: 'uppercase',
			letterSpacing: '0.04em'
		},

		'.cm-strong': { fontWeight: '700' },
		'.cm-em': { fontStyle: 'italic' },
		'.cm-bullet': { color: '#6b6e7a' },
		'.cm-inline-code': {
			fontFamily: "'JetBrains Mono', ui-monospace, monospace",
			background: '#24262f',
			padding: '0.1em 0.35em',
			borderRadius: '4px',
			fontSize: '0.9em'
		},
		'.cm-link': { color: '#7aa2ff', textDecoration: 'underline' },
		'.cm-task-checkbox': {
			marginRight: '0.4em',
			verticalAlign: 'middle',
			cursor: 'pointer'
		}
	},
	{ dark: true }
);

export function markdownLanguage() {
	// GFM as the base parser so task-list markers (`- [x]`) parse as
	// TaskMarker nodes instead of links.
	return markdown({ base: gfm, codeLanguages: languages });
}
