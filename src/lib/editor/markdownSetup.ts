import { markdown, markdownLanguage as gfm } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';
import { mathCompletionSource } from './mathComplete';
import { wikiCompletionSource } from './wikiComplete';
import { tagCompletionSource } from './tagComplete';

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
		'.cm-wikilink': {
			color: 'var(--primary)',
			backgroundColor: 'rgba(181, 196, 255, 0.12)',
			padding: '0.05em 0.35em',
			borderRadius: '4px',
			cursor: 'pointer'
		},
		'.cm-wikilink-unresolved': {
			color: 'var(--outline)',
			border: '1px dashed var(--outline-variant)'
		},
		'.cm-wikilink-source': {
			backgroundColor: 'rgba(181, 196, 255, 0.12)',
			borderRadius: '3px'
		},
		'.cm-tag': {
			color: 'var(--primary)',
			backgroundColor: 'rgba(181, 196, 255, 0.12)',
			padding: '0.05em 0.35em',
			borderRadius: '4px'
		},
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
		},
		// Properties box: read-only key/value rows over the `---` block.
		// Padding, never vertical margin (same height-map rule as math).
		'.cm-prop-block': {
			display: 'block',
			margin: '0',
			padding: '0.6rem 0.8rem',
			backgroundColor: 'var(--surface-container)',
			border: '1px solid var(--border-default)',
			borderRadius: '6px'
		},
		'.cm-prop-row': {
			display: 'flex',
			gap: '8px',
			fontSize: 'var(--font-ui-small)',
			lineHeight: '1.6'
		},
		'.cm-prop-key': {
			flex: 'none',
			width: '88px',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			color: 'var(--outline-variant)'
		},
		'.cm-prop-value': {
			flex: '1',
			minWidth: '0',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			color: 'var(--on-surface)'
		},
		// Callouts: per-line backgrounds form the box (line decorations, so
		// no height-map risk). Accent per type via CSS vars, corners rounded
		// on first/last lines only.
		'.cm-callout': {
			backgroundColor: 'var(--callout-bg)',
			borderLeft: '3px solid var(--callout-accent)',
			paddingLeft: '0.7em',
			paddingRight: '0.7em'
		},
		'.cm-callout-first': {
			paddingTop: '0.55em',
			borderTopLeftRadius: '6px',
			borderTopRightRadius: '6px'
		},
		'.cm-callout-last': {
			paddingBottom: '0.55em',
			borderBottomLeftRadius: '6px',
			borderBottomRightRadius: '6px'
		},
		'.cm-callout-body': {
			paddingTop: '0.1em'
		},
		'.cm-callout-title': { fontWeight: '700' },
		'.cm-callout-marker': {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '0.35em',
			marginRight: '0.45em',
			verticalAlign: 'middle'
		},
		'.cm-callout-icon': {
			fontSize: '17px',
			color: 'var(--callout-accent)'
		},
		'.cm-callout-fold': {
			fontSize: '16px',
			color: 'var(--outline)'
		},
		'.cm-callout-default-title': {
			fontWeight: '700',
			color: 'var(--callout-accent)'
		},
		'.cm-callout-note': {
			'--callout-accent': '#448aff',
			'--callout-bg': 'rgba(68, 138, 255, 0.12)'
		},
		'.cm-callout-abstract': {
			'--callout-accent': '#00b8d4',
			'--callout-bg': 'rgba(0, 184, 212, 0.12)'
		},
		'.cm-callout-info': {
			'--callout-accent': '#448aff',
			'--callout-bg': 'rgba(68, 138, 255, 0.12)'
		},
		'.cm-callout-todo': {
			'--callout-accent': '#448aff',
			'--callout-bg': 'rgba(68, 138, 255, 0.12)'
		},
		'.cm-callout-tip': {
			'--callout-accent': '#00bfa5',
			'--callout-bg': 'rgba(0, 191, 165, 0.12)'
		},
		'.cm-callout-success': {
			'--callout-accent': '#23d160',
			'--callout-bg': 'rgba(35, 209, 96, 0.12)'
		},
		'.cm-callout-question': {
			'--callout-accent': '#eab308',
			'--callout-bg': 'rgba(234, 179, 8, 0.12)'
		},
		'.cm-callout-warning': {
			'--callout-accent': '#fb8500',
			'--callout-bg': 'rgba(251, 133, 0, 0.12)'
		},
		'.cm-callout-failure': {
			'--callout-accent': '#f43f5e',
			'--callout-bg': 'rgba(244, 63, 94, 0.12)'
		},
		'.cm-callout-example': {
			'--callout-accent': '#a78bfa',
			'--callout-bg': 'rgba(167, 139, 250, 0.12)'
		},
		'.cm-callout-quote': {
			'--callout-accent': '#9ca3af',
			'--callout-bg': 'rgba(156, 163, 175, 0.12)'
		},
		'.cm-tooltip-autocomplete': {
			backgroundColor: 'var(--surface-container)',
			border: '1px solid var(--border-raised)',
			borderRadius: 'var(--radius-lg)',
			boxShadow: 'var(--shadow-pop)',
			color: 'var(--on-surface)'
		},
		'.cm-tooltip-autocomplete ul': {
			fontFamily: 'var(--font-ui)'
		},
		'.cm-tooltip-autocomplete li[aria-selected]': {
			backgroundColor: 'var(--surface-container-highest)',
			color: 'var(--on-surface)'
		},
		'.cm-tooltip-autocomplete .cm-completionDetail': {
			color: 'var(--outline)',
			fontStyle: 'normal'
		},
		'.cm-tooltip-autocomplete .cm-completionMatchedText': {
			color: 'var(--primary)',
			textDecoration: 'none'
		}
	},
	{ dark: true }
);

export function markdownLanguage() {
	// GFM as the base parser so task-list markers (`- [x]`) parse as
	// TaskMarker nodes instead of links.
	const support = markdown({ base: gfm, codeLanguages: languages });
	// Math + wikilink + tag completions ride the language-data channel (same
	// one the built-in HTML-tag completion uses) so all four stay active.
	return [
		support,
		support.language.data.of({ autocomplete: mathCompletionSource }),
		support.language.data.of({ autocomplete: wikiCompletionSource }),
		support.language.data.of({ autocomplete: tagCompletionSource })
	];
}
