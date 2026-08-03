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
			fontFamily: 'system-ui, sans-serif',
			backgroundColor: 'var(--background)',
			color: 'var(--on-surface)'
		},
		'.cm-content': {
			fontFamily: 'system-ui, sans-serif',
			padding: '2rem 1.5rem',
			lineHeight: '1.65'
		},
		'.cm-line': { padding: '0 2px' },
		'&.cm-focused': { outline: 'none' },
		'.cm-gutters': {
			backgroundColor: 'var(--background)',
			color: '#3f424d',
			border: 'none',
			fontSize: '0.75rem',
			userSelect: 'none'
		},
		'.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem 0 0.75rem', minWidth: '1rem' },
		'.cm-cursor': { borderLeftColor: 'var(--on-surface)' },
		'.cm-selectionBackground': { backgroundColor: 'var(--selection-bg) !important' },

'.cm-heading-1': { fontSize: '1.7em', fontWeight: '700', color: 'var(--on-surface)' },
		'.cm-heading-2': { fontSize: '1.4em', fontWeight: '700', color: 'var(--on-surface)' },
		'.cm-heading-3': { fontSize: '1.2em', fontWeight: '600', color: 'var(--on-surface)' },
		'.cm-heading-4': { fontSize: '1.05em', fontWeight: '600', color: 'var(--on-surface)' },
		'.cm-heading-5': { fontSize: '0.95em', fontWeight: '600', color: 'var(--on-surface-variant)' },
		'.cm-heading-6': {
			fontSize: '0.85em',
			fontWeight: '600',
			color: 'var(--outline)',
			textTransform: 'uppercase',
			letterSpacing: '0.04em'
		},

		'.cm-strong': { fontWeight: '700' },
		'.cm-em': { fontStyle: 'italic' },
		'.cm-bullet': { color: 'var(--on-surface-variant)' },
		'.cm-inline-code': {
			fontFamily: "var(--font-mono)",
			background: 'var(--surface-container-high)',
			color: 'var(--on-surface)',
			padding: '0.1em 0.35em',
			borderRadius: '4px',
			fontSize: '0.9em'
		},
		'.cm-link': { color: 'var(--primary)', textDecoration: 'underline' },
		// Rendered image: full-width lines, unmounted when the cursor leaves.
		'& .cm-image': {
			display: 'block',
			maxWidth: '100%',
			maxHeight: '60vh',
			margin: '0.4em 0',
			borderRadius: '6px',
			objectFit: 'contain'
		},
		'.cm-task-checkbox': {
			appearance: 'none',
			WebkitAppearance: 'none',
			width: '14px',
			height: '14px',
			margin: '0 0.4em 0 0',
			verticalAlign: 'middle',
			cursor: 'pointer',
			borderRadius: '3px',
			border: '1.5px solid #5a5d68',
			backgroundColor: 'transparent',
			position: 'relative',
			flexShrink: '0'
		},
		'.cm-task-checkbox:hover': {
			borderColor: 'var(--primary)'
		},
		'.cm-task-checkbox:checked': {
			backgroundColor: 'var(--primary)',
			borderColor: 'var(--primary)'
		},
		'.cm-task-checkbox:checked::after': {
			content: '"✓"',
			color: 'var(--on-primary)',
			fontSize: '10px',
			fontWeight: '700',
			lineHeight: '1',
			position: 'absolute',
			inset: '1px auto auto 2px'
		}
	},
	{ dark: true }
);

export function markdownLanguage() {
	// GFM as the base parser so task-list markers (`- [x]`) parse as
	// TaskMarker nodes instead of links.
	return markdown({ base: gfm, codeLanguages: languages });
}
