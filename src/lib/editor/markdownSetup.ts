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
			padding: '2rem 1.5rem',
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
		// Rendered image: full-width lines, unmounted when the cursor leaves.
		'& .cm-image': {
			display: 'block',
			maxWidth: '100%',
			maxHeight: '60vh',
			margin: '0.4em 0',
			borderRadius: '6px',
			objectFit: 'contain'
		},
		'& .cm-callout': {
			borderLeft: '3px solid #4f7cff',
			background: 'rgba(79, 124, 255, 0.08)',
			borderRadius: '6px',
			// No vertical margin: CodeMirror measures block widgets without
			// margins, so any margin here makes line positions (and mouse
			// clicks) drift further from the real layout on every callout.
			padding: '0.55em 0.9em'
		},
		'& .cm-callout-title': {
			display: 'flex',
			alignItems: 'center',
			gap: '0.45em',
			fontWeight: '600',
			color: '#7aa2ff',
			marginBottom: '0.1em'
		},
		'& .cm-callout-icon': {
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			width: '1.25em',
			height: '1.25em',
			borderRadius: '50%',
			background: '#4f7cff',
			color: '#14151a',
			fontSize: '0.72em',
			fontWeight: '700',
			flexShrink: 0
		},
		'& .cm-callout-content': {
			color: '#c9cbd6',
			fontSize: '0.92em',
			whiteSpace: 'pre-wrap'
		},
		'& .cm-callout-tip': {
			borderLeftColor: '#57ab5a',
			background: 'rgba(87, 171, 90, 0.10)'
		},
		'& .cm-callout-tip .cm-callout-title': { color: '#57ab5a' },
		'& .cm-callout-tip .cm-callout-icon': { background: '#57ab5a' },
		'& .cm-callout-important': {
			borderLeftColor: '#b07dff',
			background: 'rgba(176, 125, 255, 0.10)'
		},
		'& .cm-callout-important .cm-callout-title': { color: '#b07dff' },
		'& .cm-callout-important .cm-callout-icon': { background: '#b07dff' },
		'& .cm-callout-warning': {
			borderLeftColor: '#e5a63b',
			background: 'rgba(229, 166, 59, 0.10)'
		},
		'& .cm-callout-warning .cm-callout-title': { color: '#e5a63b' },
		'& .cm-callout-warning .cm-callout-icon': { background: '#e5a63b' },
		'& .cm-callout-caution': {
			borderLeftColor: '#ff6b6b',
			background: 'rgba(255, 107, 107, 0.10)'
		},
		'& .cm-callout-caution .cm-callout-title': { color: '#ff6b6b' },
		'& .cm-callout-caution .cm-callout-icon': { background: '#ff6b6b' },
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
