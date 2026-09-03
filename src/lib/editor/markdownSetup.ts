import { markdown, markdownLanguage as gfm } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

// Dark-tuned code colors (OneDark-like) for fenced blocks on
// var(--surface-container) bg. Replaces defaultHighlightStyle which
// is built for light backgrounds.
export const codeTheme = HighlightStyle.define([
	{ tag: t.keyword, color: '#c678dd' },
	{ tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#e06c75' },
	{ tag: [t.function(t.variableName), t.labelName], color: '#61afef' },
	{ tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#d19a66' },
	{
		tag: [t.definition(t.name), t.separator],
		color: '#e3e1e9'
	},
	{
		tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
		color: '#e5c07b'
	},
	{
		tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
		color: '#56b6c2'
	},
	{ tag: [t.meta, t.comment], color: '#7f848e', fontStyle: 'italic' },
	{ tag: t.strong, fontWeight: 'bold' },
	{ tag: t.emphasis, fontStyle: 'italic' },
	{ tag: t.strikethrough, textDecoration: 'line-through' },
	{ tag: t.link, color: '#b5c4ff', textDecoration: 'underline' },
	{ tag: t.heading, fontWeight: 'bold', color: '#e3e1e9' },
	{ tag: [t.atom, t.bool, t.special(t.variableName)], color: '#d19a66' },
	{ tag: [t.processingInstruction, t.string, t.inserted], color: '#98c379' },
	{ tag: t.invalid, color: '#ffffff' }
]);

export const codeHighlight = syntaxHighlighting(codeTheme);

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
		'.cm-lineNumbers .cm-gutterElement': {
			padding: '0 0.5rem 0 0.75rem',
			minWidth: '1rem',
			display: 'flex',
			alignItems: 'center'
		},
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
		// NOTE: no vertical margin - CodeMirror measures block widgets without
		// margins, so any vertical margin desyncs the height map (gutter,
		// cursor coords and arrow targets all shift below the widget).
		'& .cm-image': {
			display: 'block',
			maxWidth: '100%',
			maxHeight: '60vh',
			margin: '0',
			padding: '0.4em 0',
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
		},
		'.cm-codeblock-line': {
			backgroundColor: 'var(--surface-container)',
			borderLeft: '1px solid var(--border-default)',
			borderRight: '1px solid var(--border-default)'
		},
		'.cm-codeblock-content': {
			fontFamily: 'var(--font-mono)',
			fontSize: '0.88em'
		},
		'.cm-math-inline': {
			display: 'inline-block',
			padding: '0 0.15em',
			verticalAlign: 'middle'
		},
		'.cm-math-block': {
			display: 'block',
			textAlign: 'center',
			// No vertical margin here, same reason as .cm-image above:
			// unmeasured margins shift every line below the widget. The old
			// 0.75rem margin is folded into padding so spacing is measured.
			margin: '0',
			padding: '1.5rem 1rem',
			backgroundColor: 'var(--surface-container)',
			border: '1px solid var(--border-default)',
			borderRadius: '6px',
			overflowX: 'auto'
		},
		'.cm-math-source': {
			backgroundColor: 'rgba(181, 196, 255, 0.12)',
			borderRadius: '3px',
			padding: '0 0.15em'
		},
		'.cm-math-source-block': {
			backgroundColor: 'var(--surface-container)',
			borderLeft: '1px solid var(--border-default)',
			borderRight: '1px solid var(--border-default)'
		}
	},
	{ dark: true }
);

export function markdownLanguage() {
	// GFM as the base parser so task-list markers (`- [x]`) parse as
	// TaskMarker nodes instead of links.
	return markdown({ base: gfm, codeLanguages: languages });
}
