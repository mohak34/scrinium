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
		// Rendered table (tableBlock.ts), a grid like a database view. The
		// print/share look in theme.css is separate. Padding, not margin, same
		// height-map reason as .cm-math-block. white-space resets the editor's
		// break-spaces, which would turn the renderer's newlines between rows
		// into text that splits the table; the wrap resets undo its
		// overflow-wrap: anywhere so cells wrap at spaces.
		'.cm-table-block': {
			padding: '0.75rem 0 0.5rem',
			cursor: 'default',
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
		'.cm-table-block button': {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '4px',
			height: '24px',
			padding: '0 6px',
			border: 'none',
			borderRadius: '4px',
			background: 'none',
			font: '500 12px var(--font-ui)',
			color: 'inherit',
			cursor: 'pointer',
			transition: 'background-color 80ms, color 80ms'
		},
		'.cm-table-block button:hover': { color: 'var(--text-2)', background: 'var(--hover)' },
		'.cm-table-block button.on': { color: 'var(--accent)' },
		'.cm-table-block button .material-symbols-outlined': { fontSize: '15px' },
		'.cm-table-bar': {
			display: 'flex',
			alignItems: 'center',
			gap: '2px',
			height: '28px',
			margin: '0 0 4px -6px',
			font: '500 12px var(--font-ui)',
			color: 'var(--text-4)'
		},
		'.cm-table-block:hover .cm-table-bar': { color: 'var(--text-3)' },
		'.cm-table-count': { padding: '0 6px', fontVariantNumeric: 'tabular-nums' },
		'.cm-table-bar .cm-table-md': { marginLeft: 'auto' },
		'.cm-table-block .cm-table-addrow': {
			height: '28px',
			gap: '6px',
			padding: '0 10px',
			marginTop: '2px',
			color: 'var(--text-3)',
			opacity: '0',
			transition: 'opacity 80ms, background-color 80ms, color 80ms'
		},
		'.cm-table-block:hover .cm-table-addrow': { opacity: '1' },
		'.cm-table-block .cm-table-addrow:hover': { color: 'var(--text)' },
		// Only a table wider than the note scrolls: a scroll box clips the
		// cell editor, which can be taller than its cell.
		'.cm-table-wide .cm-table-scroll': {
			overflowX: 'auto',
			scrollbarWidth: 'thin',
			scrollbarColor: 'var(--line-3) transparent'
		},
		'.cm-table-wide :is(th, td):first-child': { position: 'sticky', left: '0', zIndex: '1', background: 'var(--bg)' },
		'.cm-table-block table': {
			tableLayout: 'fixed',
			borderCollapse: 'separate',
			borderSpacing: '0',
			borderLeft: '1px solid var(--line)'
		},
		'.cm-table-block :is(th, td)': {
			position: 'relative',
			height: '32px',
			padding: '6px 10px 5px',
			textAlign: 'left',
			verticalAlign: 'top',
			borderRight: '1px solid var(--line)',
			borderBottom: '1px solid var(--line)',
			font: '14px/20px var(--font-read)',
			color: 'var(--text)'
		},
		'.cm-table-block th': {
			borderTop: '1px solid var(--line)',
			font: '500 12px/20px var(--font-ui)',
			color: 'var(--text-3)',
			borderBottomColor: 'var(--line-2)',
			cursor: 'pointer',
			userSelect: 'none',
			transition: 'background-color 80ms, color 80ms'
		},
		'.cm-table-block th:hover': { background: 'var(--raise)', color: 'var(--text-2)' },
		'.cm-table-block th:hover .cm-th-icon': { color: 'var(--text-3)' },
		// The drag handle on a header's right edge (resizeColumn).
		'.cm-th-rz': { position: 'absolute', top: '0', right: '-1px', width: '7px', height: '100%', cursor: 'col-resize', zIndex: '4' },
		'.cm-th-rz:hover, .cm-th-rz.cm-th-rz-drag': {
			background: 'linear-gradient(var(--accent), var(--accent)) right / 1px 100% no-repeat'
		},
		'.cm-table-block th .cm-cell-v': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
		'.cm-th-icon': { fontSize: '15px', verticalAlign: '-3px', marginRight: '6px', color: 'var(--text-4)' },
		'.cm-th-sorted .cm-th-icon': { color: 'var(--accent)' },
		'.cm-table-block th.cm-th-filtered': { boxShadow: 'inset 0 -1px 0 var(--accent)' },
		'.cm-table-block tr:hover td': { background: '#0e0e0e' },
		'.cm-table-block .cm-col-number': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
		'.cm-table-block td:is(.cm-col-number, .cm-col-date, .cm-col-deadline, .cm-col-status) .cm-cell-v': {
			whiteSpace: 'nowrap',
			overflow: 'hidden',
			textOverflow: 'ellipsis'
		},
		'.cm-table-block td.cm-col-status .cm-cell-v': { color: 'var(--status, var(--text))' },
		'.cm-table-block td.cm-col-status[style] .cm-cell-v::before': {
			content: '""',
			display: 'inline-block',
			width: '7px',
			height: '7px',
			borderRadius: '2px',
			background: 'var(--status)',
			marginRight: '7px',
			verticalAlign: '1px'
		},
		'.cm-table-block td.cm-cell-over': { color: 'var(--red)' },
		'.cm-table-block td.cm-cell-near': { color: 'var(--orange)' },
		'.cm-table-block td.cm-cell-bad': { color: 'var(--text-2)', cursor: 'help' },
		'.cm-table-block td.cm-cell-bad .cm-cell-v': {
			textDecoration: 'underline dotted var(--red)',
			textDecorationThickness: '1.5px',
			textUnderlineOffset: '4px'
		},
		// The row the cursor keeps on screen though the filter hides it.
		'.cm-table-block tr.cm-row-out .cm-cell-v': { opacity: '0.4' },
		'.cm-table-block tr.cm-row-out td:first-child': { boxShadow: 'inset 2px 0 0 var(--text-4)' },
		// Natural widths are measured with the table laid out freely.
		'.cm-table-block table.cm-table-measure': { tableLayout: 'auto !important', width: 'max-content !important' },
		'.cm-table-measure :is(th, td)': { whiteSpace: 'nowrap' },
		'.cm-table-block a': { color: 'var(--accent)', textDecoration: 'none', textUnderlineOffset: '3px' },
		'.cm-table-block a:hover': { textDecoration: 'underline' },
		'.cm-table-block .print-wikilink': { color: 'var(--accent)' },
		'.cm-table-block .print-tag': { color: 'var(--violet)' },
		'.cm-table-block .print-inline-code': {
			font: '12.5px/1 var(--font-mono)',
			background: 'var(--press)',
			color: 'var(--text-2)',
			padding: '2px 4px',
			borderRadius: '3px'
		},
		// Status choices in a cell's list (cellCompletions).
		'.cm-choice-dot': { display: 'inline-block', width: '7px', height: '7px', borderRadius: '2px', marginRight: '8px', verticalAlign: '1px' },
		// The Contains input (askText) and the date cell's calendar.
		'.cm-table-ask': { position: 'fixed', zIndex: '1000' },
		'.cm-table-ask, .cm-tooltip.cm-date-pop': {
			background: 'var(--raise)',
			border: '1px solid var(--line-3)',
			borderRadius: '8px',
			boxShadow: '0 12px 32px rgba(0,0,0,.6)',
			padding: '4px',
			font: '13px/20px var(--font-ui)',
			color: 'var(--text-2)'
		},
		'.cm-table-ask input': {
			display: 'block',
			width: '220px',
			height: '28px',
			padding: '0 8px',
			background: 'var(--bg)',
			border: '1px solid var(--line-2)',
			borderRadius: '4px',
			color: 'var(--text)',
			font: '13px var(--font-ui)',
			outline: 'none'
		},
		'.cm-table-ask input:focus': { borderColor: 'var(--line-3)' },
		'.cm-table-ask input::placeholder': { color: 'var(--text-4)' },
		'.cm-tooltip.cm-date-pop': { width: '240px', padding: '8px', cursor: 'default' },
		'.cm-date-pop button': {
			border: 'none',
			background: 'none',
			borderRadius: '4px',
			color: 'var(--text-3)',
			cursor: 'pointer',
			font: '500 12px var(--font-ui)',
			transition: 'background-color 80ms, color 80ms'
		},
		'.cm-date-pop button:hover': { background: 'var(--press)', color: 'var(--text)' },
		'.cm-date-head': { display: 'flex', alignItems: 'center', height: '28px', font: '500 13px var(--font-ui)', color: 'var(--text)' },
		'.cm-date-head span:not(.material-symbols-outlined)': { flex: '1', textAlign: 'center' },
		'.cm-date-head button': { width: '28px', height: '28px', display: 'grid', placeItems: 'center' },
		'.cm-date-head .material-symbols-outlined': { fontSize: '18px' },
		'.cm-date-grid': { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' },
		'.cm-date-wd': { height: '24px', font: '11px/24px var(--font-ui)', color: 'var(--text-4)', textAlign: 'center' },
		'.cm-date-grid button': {
			height: '28px',
			font: '13px var(--font-read)',
			fontVariantNumeric: 'tabular-nums',
			color: 'var(--text-2)'
		},
		'.cm-date-grid button.other': { color: 'var(--text-4)' },
		'.cm-date-grid button.today': { color: 'var(--accent)', fontWeight: '700' },
		'.cm-date-grid button.on, .cm-date-grid button.on:hover': { background: 'var(--accent-fill)', color: '#fff' },
		'.cm-date-foot': { display: 'flex', alignItems: 'center', gap: '2px', marginTop: '4px', height: '24px' },
		'.cm-date-foot button': { height: '24px', padding: '0 6px' },
		'.cm-date-hint': { flex: '1', font: '12px/20px var(--font-ui)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
		'.cm-date-hint.bad': { color: 'var(--red)' },
		// The cell editor lies over its cell (the rendered content keeps the
		// cell's size), so opening it never moves a column. It is a CodeMirror
		// view nested in the widget, so the main editor's descendant rules
		// (content and line padding) reach it and are undone here.
		'.cm-cell-editing > .cm-cell-v': { visibility: 'hidden' },
		// CodeMirror's base theme pins every editor to relative !important.
		'.cm-table-block .cm-cell-editing > .cm-editor': {
			position: 'absolute !important',
			top: '0',
			left: '0',
			right: '0',
			minHeight: '100%',
			zIndex: '2',
			padding: '6px 10px 5px',
			background: 'var(--raise)',
			boxShadow: 'inset 0 0 0 2px var(--accent), 0 8px 24px rgba(0,0,0,.5)',
			fontSize: 'inherit'
		},
		'.cm-table-block .cm-editor.cm-focused': { outline: 'none' },
		'.cm-table-block .cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
		'.cm-table-block .cm-content': { padding: '0', minHeight: '1lh' },
		'.cm-table-block .cm-line': { padding: '0' },
		// Vim mode hides the native caret on every line in the main editor,
		// cell lines included; the cell editor draws no cursor of its own.
		'.cm-table-block .cm-editor .cm-line': { caretColor: 'var(--accent) !important' },
		'.cm-table-block .cm-table-cursor': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
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
