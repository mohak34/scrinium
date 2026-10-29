import { markdown, markdownLanguage as gfm } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';
import { mathCompletionSource } from './mathComplete';
import { wikiCompletionSource } from './wikiComplete';
import { tagCompletionSource } from './tagComplete';

// Code colors for fenced blocks, tuned to sit on the --panel code surface
// next to the Palo Alto accent. Replaces defaultHighlightStyle, which is
// built for light backgrounds.
export const codeTheme = HighlightStyle.define([
	{ tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: '#c4a8ff' },
	{ tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#e8e6e3' },
	{ tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#8fb3ff' },
	{ tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#f0a35e' },
	{ tag: [t.definition(t.name), t.separator], color: '#e8e6e3' },
	{
		tag: [t.typeName, t.className, t.changed, t.annotation, t.modifier, t.self, t.namespace],
		color: '#e8c872'
	},
	{ tag: t.number, color: '#f0a35e' },
	{
		tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.special(t.string)],
		color: '#7fc8bc'
	},
	{ tag: [t.meta, t.comment], color: '#6c6965', fontStyle: 'italic' },
	{ tag: t.strong, fontWeight: 'bold' },
	{ tag: t.emphasis, fontStyle: 'italic' },
	{ tag: t.strikethrough, textDecoration: 'line-through' },
	{ tag: t.link, color: '#8fb3ff', textDecoration: 'underline' },
	{ tag: t.heading, fontWeight: 'bold', color: '#e8e6e3' },
	{ tag: [t.atom, t.bool, t.special(t.variableName)], color: '#f0a35e' },
	{ tag: [t.processingInstruction, t.string, t.inserted], color: '#9fd4a3' },
	{ tag: t.invalid, color: '#ff7a85' }
]);

export const codeHighlight = syntaxHighlighting(codeTheme);

// Base visual theme. Notes read in the reading face at full width; the gutter
// carries line numbers and fold chevrons, and marks stay quiet so the text
// leads. Font size comes from the editor setting via its own compartment.
export const baseTheme = EditorView.theme(
	{
		'&': {
			height: '100%',
			fontSize: '17px',
			fontFamily: 'var(--font-read)',
			backgroundColor: 'var(--bg)',
			color: 'var(--text)'
		},
		'.cm-scroller': { fontFamily: 'var(--font-read)', lineHeight: '1.75' },
		'.cm-content': {
			fontFamily: 'var(--font-read)',
			padding: '28px 56px 40vh 12px',
			caretColor: 'var(--accent)'
		},
		// Wrapped content may shrink below its widest block, so a wide table
		// scrolls inside its widget instead of widening the whole note.
		'.cm-content.cm-lineWrapping': { minWidth: '0' },
		'.cm-line': { padding: '0 2px' },
		'&.cm-focused': { outline: 'none' },
		// Vim's bottom panel renders for every dialog even with the status
		// bar off. All dialogs are re-homed into Svelte chrome (command line
		// for inputs, toasts for notices), so the panel is always empty -
		// keep it hidden.
		'.cm-vim-panel:empty': { display: 'none' },
		'.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.022)' },
		'.cm-gutters': {
			backgroundColor: 'var(--bg)',
			color: 'var(--text-4)',
			border: 'none',
			fontFamily: 'var(--font-mono)',
			fontSize: '12px',
			userSelect: 'none'
		},
		'.cm-lineNumbers .cm-gutterElement': {
			padding: '0 14px 0 20px',
			minWidth: '2.2em',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'flex-end'
		},
		'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)' },
		// Fold gutter: quiet chevrons, accent on hover. Geometric shapes,
		// not emoji, so no icon font needed inside the gutter.
		'.cm-foldGutter': { width: '1.4em' },
		'.cm-foldGutter .cm-gutterElement': {
			color: 'var(--text-3)',
			cursor: 'pointer',
			fontSize: '1em',
			paddingLeft: '0.2em'
		},
		'.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--accent)' },
		'.cm-foldPlaceholder': {
			backgroundColor: 'var(--raise)',
			border: '1px solid var(--line-2)',
			borderRadius: '4px',
			color: 'var(--text-2)',
			margin: '0 0.25em',
			padding: '0 0.35em'
		},
		'.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
		// Vim normal-mode block cursor in the accent, hollow when blurred.
		'& .cm-fat-cursor': {
			background: 'var(--accent) !important',
			color: 'var(--bg) !important',
			outline: 'none !important'
		},
		'&:not(.cm-focused) .cm-fat-cursor': {
			background: 'none !important',
			outline: '1px solid var(--accent) !important',
			color: 'inherit !important'
		},
		'.cm-selectionBackground': { backgroundColor: 'var(--sel) !important' },
		'.cm-searchMatch': {
			backgroundColor: 'color-mix(in srgb, var(--yellow) 22%, transparent)',
			outline: 'none'
		},
		'.cm-searchMatch-selected': { backgroundColor: 'var(--sel)' },
		'.cm-panels': {
			backgroundColor: 'var(--panel)',
			color: 'var(--text)',
			fontFamily: 'var(--font-ui)'
		},
		'.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
		'.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
		'.cm-search': { fontSize: 'var(--fs-sm)', padding: '6px 10px' },
		'.cm-search input, .cm-search button': {
			fontFamily: 'var(--font-ui)',
			fontSize: 'var(--fs-sm)',
			backgroundColor: 'var(--raise)',
			backgroundImage: 'none',
			color: 'var(--text)',
			border: '1px solid var(--line-2)',
			borderRadius: '6px',
			padding: '3px 8px'
		},
		'.cm-search input:focus': { borderColor: 'var(--accent)', outline: 'none' },
		'.cm-search label': { color: 'var(--text-2)' },
		'.cm-search button[name=close]': {
			color: 'var(--text-3)',
			backgroundColor: 'transparent',
			border: 'none'
		},

		'.cm-heading-1': {
			fontSize: '2em',
			fontWeight: '700',
			lineHeight: '1.3',
			letterSpacing: '-0.015em',
			color: 'var(--text)'
		},
		'.cm-heading-2': { fontSize: '1.4em', fontWeight: '700', lineHeight: '1.4', color: 'var(--text)' },
		'.cm-heading-3': { fontSize: '1.15em', fontWeight: '700', color: 'var(--text)' },
		'.cm-heading-4': { fontSize: '1.05em', fontWeight: '650', color: 'var(--text)' },
		'.cm-heading-5': { fontSize: '1em', fontWeight: '650', color: 'var(--text-2)' },
		'.cm-heading-6': { fontSize: '0.95em', fontWeight: '650', color: 'var(--text-3)' },

		'.cm-strong': { fontWeight: '700', color: '#ffffff' },
		'.cm-em': { fontStyle: 'italic' },
		'.cm-bullet': { color: 'var(--text-3)' },
		'.cm-inline-code': {
			fontFamily: 'var(--font-mono)',
			background: 'var(--raise)',
			border: '1px solid var(--line-2)',
			color: 'var(--rose)',
			padding: '0.05em 0.35em',
			borderRadius: '4px',
			fontSize: '0.8em'
		},
		'.cm-link': {
			color: 'var(--blue)',
			textDecoration: 'underline',
			textDecorationColor: 'color-mix(in srgb, var(--blue) 40%, transparent)',
			textUnderlineOffset: '3px'
		},
		'.cm-wikilink': {
			color: 'var(--accent)',
			textDecoration: 'underline',
			textDecorationColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
			textUnderlineOffset: '3px',
			cursor: 'pointer'
		},
		'.cm-wikilink:hover': { textDecorationColor: 'var(--accent)' },
		'.cm-wikilink-unresolved': {
			color: 'var(--text-3)',
			textDecorationStyle: 'dashed',
			textDecorationColor: 'var(--text-3)'
		},
		'.cm-wikilink-archived': {
			color: 'var(--text-3)',
			textDecorationColor: 'var(--text-4)'
		},
		'.cm-wikilink-source': {
			backgroundColor: 'var(--accent-dim)',
			borderRadius: '3px'
		},
		'.cm-tag': {
			color: 'var(--violet)',
			backgroundColor: 'color-mix(in srgb, var(--violet) 12%, transparent)',
			fontFamily: 'var(--font-ui)',
			fontSize: '0.85em',
			padding: '0.05em 0.4em',
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
			borderRadius: '8px',
			objectFit: 'contain'
		},
		'.cm-task-checkbox': {
			appearance: 'none',
			WebkitAppearance: 'none',
			width: '17px',
			height: '17px',
			margin: '0 0.55em 0 0',
			verticalAlign: '-0.2em',
			cursor: 'pointer',
			borderRadius: '4px',
			border: '1.5px solid #4a4744',
			backgroundColor: 'transparent',
			position: 'relative',
			flexShrink: '0'
		},
		'.cm-task-checkbox:hover': { borderColor: 'var(--accent)' },
		'.cm-task-checkbox:checked': {
			backgroundColor: 'var(--accent-fill)',
			borderColor: 'var(--accent-fill)'
		},
		'.cm-task-checkbox:checked::after': {
			content: '""',
			position: 'absolute',
			left: '4.5px',
			top: '1px',
			width: '4px',
			height: '9px',
			border: 'solid var(--on-accent)',
			borderWidth: '0 2px 2px 0',
			transform: 'rotate(45deg)'
		},
		'.cm-codeblock-line': {
			backgroundColor: 'var(--panel)',
			borderLeft: '1px solid var(--line)',
			borderRight: '1px solid var(--line)',
			paddingLeft: '16px'
		},
		'.cm-codeblock-content': {
			fontFamily: 'var(--font-mono)',
			fontSize: '0.8em'
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
			// unmeasured margins shift every line below the widget.
			margin: '0',
			padding: '1.25rem 1rem',
			backgroundColor: 'var(--panel)',
			border: '1px solid var(--line)',
			borderRadius: '8px',
			overflowX: 'auto'
		},
		'.cm-math-source': {
			backgroundColor: 'var(--accent-dim)',
			borderRadius: '3px',
			padding: '0 0.15em'
		},
		'.cm-math-source-block': {
			backgroundColor: 'var(--panel)',
			borderLeft: '1px solid var(--line)',
			borderRight: '1px solid var(--line)'
		},
		// Rendered table (tableBlock.ts); table rules live in theme.css.
		// Padding, not margin, same height-map reason as .cm-math-block.
		// white-space resets the editor's break-spaces, which would turn the
		// renderer's newlines between rows into text that splits the table.
		// The wrap resets undo the editor's overflow-wrap: anywhere, which lets
		// columns shrink below their longest word and split it mid-word; cells
		// now wrap at spaces and a wide table scrolls (theme.css).
		'.cm-table-block': {
			padding: '0.5rem 0',
			cursor: 'text',
			whiteSpace: 'normal',
			wordBreak: 'normal',
			overflowWrap: 'normal'
		},
		'.cm-table-pending': {
			whiteSpace: 'pre',
			fontFamily: 'var(--font-mono)',
			fontSize: '0.85em',
			color: 'var(--text-3)'
		},
		'.cm-table-block a': { color: 'var(--blue)' },
		'.cm-table-block .print-wikilink': { color: 'var(--accent)' },
		'.cm-table-block .print-tag': { color: 'var(--violet)' },
		'.cm-table-block .print-inline-code': {
			fontFamily: 'var(--font-mono)',
			background: 'var(--raise)',
			border: '1px solid var(--line-2)',
			color: 'var(--rose)',
			padding: '0.05em 0.35em',
			borderRadius: '4px',
			fontSize: '0.8em'
		},
		// The cell editor is a CodeMirror view nested in the widget, so the
		// main editor's descendant rules (content padding, line padding)
		// reach it and are undone here. The edited cell gets an accent
		// underline, the vim normal-mode cell a tint.
		'.cm-table-block .cm-editor': { background: 'transparent', fontSize: 'inherit' },
		'.cm-table-block .cm-editor.cm-focused': { outline: 'none' },
		'.cm-table-block .cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
		'.cm-table-block .cm-content': { padding: '0', minHeight: '1lh' },
		'.cm-table-block .cm-line': { padding: '0' },
		// Vim mode hides the native caret on every line in the main editor,
		// cell lines included; the cell editor draws no cursor of its own.
		'.cm-table-block .cm-editor .cm-line': { caretColor: 'var(--accent) !important' },
		'.cm-table-block :is(td, th):has(.cm-editor)': { boxShadow: 'inset 0 -2px 0 var(--accent)' },
		// Column menu button in each header, lit while it sorts or filters.
		'.cm-table-block th .cm-th-menu': {
			fontSize: '16px',
			verticalAlign: 'middle',
			marginLeft: '2px',
			color: 'var(--text-3)',
			cursor: 'pointer',
			opacity: '0',
			userSelect: 'none'
		},
		'.cm-table-block tr:hover .cm-th-menu, .cm-table-block .cm-th-menu.on': { opacity: '1' },
		'.cm-table-block .cm-th-menu.on': { color: 'var(--accent)' },
		'.cm-table-block .cm-th-menu:hover': { color: 'var(--text)' },
		// The one-line sort and filter summary above a table.
		'.cm-table-bar': {
			display: 'flex',
			flexWrap: 'wrap',
			alignItems: 'center',
			gap: '0.25rem 1rem',
			fontFamily: 'var(--font-ui)',
			fontSize: '0.8em',
			color: 'var(--text-2)',
			paddingBottom: '0.35rem',
			cursor: 'default'
		},
		'.cm-table-bar b': { color: 'var(--text)', fontWeight: '500' },
		'.cm-table-chip': { display: 'inline-flex', alignItems: 'center', gap: '0.25rem' },
		'.cm-table-chip .material-symbols-outlined': {
			fontSize: '14px',
			color: 'var(--text-3)',
			cursor: 'pointer'
		},
		'.cm-table-chip .material-symbols-outlined:hover': { color: 'var(--text)' },
		'.cm-table-count': { marginLeft: 'auto', color: 'var(--text-3)' },
		'.cm-table-block td.cm-cell-num': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
		'.cm-table-block td.cm-cell-status::before': {
			content: '""',
			display: 'inline-block',
			width: '0.5em',
			height: '0.5em',
			borderRadius: '50%',
			background: 'var(--status)',
			marginRight: '0.45em',
			verticalAlign: '0.1em'
		},
		'.cm-table-block td.cm-cell-over': { color: 'var(--red)' },
		'.cm-table-block td.cm-cell-near': { color: 'var(--yellow)' },
		'.cm-table-block .cm-table-cursor': {
			background: 'color-mix(in srgb, var(--accent-fill) 40%, transparent)'
		},
		'&.cm-in-table :is(.cm-cursorLayer, .cm-vimCursorLayer)': { display: 'none' },
		// Raw table lines while editing: monospace so the pipes line up.
		'.cm-table-source': { fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
		// Plain quotes: a quiet rule and dimmer text. Line decorations, so no
		// height-map risk, same as callouts.
		'.cm-quote': {
			borderLeft: '2px solid var(--line-3)',
			color: 'var(--text-2)',
			paddingLeft: '1em'
		},
		// Callouts: per-line backgrounds form the box (line decorations, so
		// no height-map risk). Flat tint with a left rule in the kind color.
		'.cm-callout': {
			backgroundColor: 'var(--callout-bg)',
			borderLeft: '2px solid var(--callout-accent)',
			paddingLeft: '1em',
			paddingRight: '1em',
			fontFamily: 'var(--font-ui)',
			fontSize: '0.9em',
			color: 'var(--text-2)'
		},
		'.cm-callout-first': { paddingTop: '0.55em', borderTopRightRadius: '6px' },
		'.cm-callout-last': { paddingBottom: '0.55em', borderBottomRightRadius: '6px' },
		'.cm-callout-body': { paddingTop: '0.1em' },
		'.cm-callout-title': { fontWeight: '700', color: 'var(--callout-accent)' },
		'.cm-callout-marker': {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '0.35em',
			marginRight: '0.45em',
			verticalAlign: 'middle'
		},
		'.cm-callout-icon': { fontSize: '18px', color: 'var(--callout-accent)' },
		'.cm-callout-fold': { fontSize: '16px', color: 'var(--text-3)' },
		'.cm-callout-default-title': { fontWeight: '700', color: 'var(--callout-accent)' },
		'.cm-callout-note, .cm-callout-info, .cm-callout-todo': {
			'--callout-accent': '#8fb3ff',
			'--callout-bg': 'rgba(143, 179, 255, 0.06)'
		},
		'.cm-callout-abstract': {
			'--callout-accent': '#7fc8bc',
			'--callout-bg': 'rgba(127, 200, 188, 0.06)'
		},
		'.cm-callout-tip': {
			'--callout-accent': '#5db8aa',
			'--callout-bg': 'rgba(93, 184, 170, 0.07)'
		},
		'.cm-callout-success': {
			'--callout-accent': '#9fd4a3',
			'--callout-bg': 'rgba(159, 212, 163, 0.06)'
		},
		'.cm-callout-question': {
			'--callout-accent': '#e8c872',
			'--callout-bg': 'rgba(232, 200, 114, 0.06)'
		},
		'.cm-callout-warning': {
			'--callout-accent': '#f0a35e',
			'--callout-bg': 'rgba(240, 163, 94, 0.07)'
		},
		'.cm-callout-failure': {
			'--callout-accent': '#ff7a85',
			'--callout-bg': 'rgba(255, 122, 133, 0.07)'
		},
		'.cm-callout-example': {
			'--callout-accent': '#c4a8ff',
			'--callout-bg': 'rgba(196, 168, 255, 0.06)'
		},
		'.cm-callout-quote': {
			'--callout-accent': '#a8a5a0',
			'--callout-bg': 'rgba(168, 165, 160, 0.05)'
		},
		'.cm-tooltip': {
			backgroundColor: 'var(--panel)',
			border: '1px solid var(--line-2)',
			borderRadius: '8px',
			color: 'var(--text)'
		},
		'.cm-tooltip-autocomplete': {
			backgroundColor: 'var(--panel)',
			border: '1px solid var(--line-2)',
			borderRadius: '10px',
			boxShadow: 'var(--shadow)',
			color: 'var(--text)',
			padding: '4px'
		},
		'.cm-tooltip-autocomplete ul': { fontFamily: 'var(--font-ui)' },
		'.cm-tooltip-autocomplete ul li': { borderRadius: '6px', padding: '3px 8px !important' },
		'.cm-tooltip-autocomplete li[aria-selected]': {
			backgroundColor: 'var(--hover)',
			color: 'var(--text)'
		},
		'.cm-tooltip-autocomplete .cm-completionDetail': {
			color: 'var(--text-3)',
			fontStyle: 'normal'
		},
		'.cm-tooltip-autocomplete .cm-completionMatchedText': {
			color: 'var(--accent)',
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
