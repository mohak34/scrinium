<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { Compartment, Prec } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { headingFoldRange, listFoldRange } from './folding';
import { findCallouts } from './callouts';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { vim, getCM } from '@replit/codemirror-vim';
	import { settings, attachmentDirFor } from '$lib/stores/settings';
	import {
	openSearchPanel,
	replaceNext,
	search,
	searchKeymap,
	highlightSelectionMatches
} from '@codemirror/search';
	import { markdownLanguage, baseTheme, codeHighlight } from './markdownSetup';
	import { autocompletion, closeCompletion, completionStatus, moveCompletionSelection } from '@codemirror/autocomplete';
	import { livePreview, setPreviewMode, isPreviewMode, urlAtPos, noteDirEffect, noteDirField, wikiCtxEffect, wikiCtxField, tagCtxEffect, tagCtxField } from './livePreview';
	import { notePathsFromTree } from './wikilinks';
	import { tree } from '$lib/stores/vault';
	import { mathBlockField } from './mathBlock';
	import { addYankFlash, clearYankFlash, yankFlashField, yankFlashTheme, YANK_NOTICE, YANK_FLASH_MS } from './yankFlash';
	import { toggleWrap, setHeading, toggleBullet, toggleTask, removeTask, insertListNewline } from './formatting';
	import { expandMathSnippet, expandMathFraction } from './mathSnippets';

	interface Props {
		value: string;
		onChange: (value: string) => void;
		notePath?: string;
	}
	let { value, onChange, notePath }: Props = $props();

	let container: HTMLDivElement;
	// $state so $effect blocks that read view (noteDir dispatch, doc sync)
	// re-run once onMount assigns it - plain let silently skipped them.
	let view = $state<EditorView | undefined>(undefined);
	let suppressChange = false;

	// Yank-flash bookkeeping (vim only, see onVimDialog): the cursor line of
	// the latest update, so operator yanks (`yy`, `yG`, ...) can cover N
	// lines from where the motion started.
	let prevCursorLine = 1;
	let yankTimer: ReturnType<typeof setTimeout> | undefined;

	// Compartments so settings (font size, gutters, wrapping) can be reconfigured
	// without recreating the whole editor.
	const lineNumbersCompartment = new Compartment();
	const wrapCompartment = new Compartment();
	const fontSizeCompartment = new Compartment();
	const vimCompartment = new Compartment();

	function themeForFontSize(size: number) {
		return EditorView.theme({
			'&': { fontSize: `${size}px` }
		});
	}

	// True when vim motions are on and the editor is in normal (or visual)
	// mode. Insert-mode helpers (list continuation, math snippets, Tab
	// indent) bail out in that case so vim owns the key.
	function inVimNormal(view: EditorView): boolean {
		if (!get(settings).editor.vimMotions) return false;
		const vimState = getCM(view)?.state.vim;
		return !!vimState && !vimState.insertMode;
	}

	// Named editor commands, callable from outside the component (the command
	// palette) once the view exists. Mirrors the keymap wiring below.
	const COMMANDS: Record<string, (view: EditorView) => void> = {
		bold: toggleWrap('**'),
		italic: toggleWrap('*'),
		strike: toggleWrap('~~'),
		code: toggleWrap('`'),
		h1: setHeading(1),
		h2: setHeading(2),
		h3: setHeading(3),
		h4: setHeading(4),
		h5: setHeading(5),
		h6: setHeading(6),
		bullet: toggleBullet,
		task: toggleTask,
		removeTask,
		find: openSearchPanel,
		replace: replaceNext,
		mathInline: wrapMathInline,
		mathBlock: insertMathBlock,
		callout: insertCallout
	};

	// Wrap the selection in `$...$` for inline math, or drop `$|$ with the
	// cursor between the dollars when nothing is selected.
	function wrapMathInline(view: EditorView) {
		const sel = view.state.selection.main;
		if (sel.empty) {
			view.dispatch({
				changes: { from: sel.head, insert: '$$' },
				selection: { anchor: sel.head + 1 }
			});
		} else {
			const text = view.state.sliceDoc(sel.from, sel.to);
			view.dispatch({
				changes: { from: sel.from, to: sel.to, insert: `$${text}$` },
				selection: { anchor: sel.from + 1, head: sel.to + 1 }
			});
		}
		view.focus();
	}

	// Insert an own-line `$$` block skeleton with the cursor on the empty
	// middle line. On a blank line it replaces the line; otherwise the block
	// goes below the current line.
	function insertMathBlock(view: EditorView) {
		const head = view.state.selection.main.head;
		const line = view.state.doc.lineAt(head);
		const onBlank = line.text.trim() === '';
		const pos = onBlank ? line.from : line.to;
		const insert = `${onBlank ? '' : '\n'}$$\n\n$$`;
		view.dispatch({
			changes: onBlank ? { from: line.from, to: line.to, insert } : { from: pos, insert },
			selection: { anchor: pos + (onBlank ? 0 : 1) + 3 }
		});
		view.focus();
	}

	// Insert an Obsidian-style callout skeleton with "Title" selected so it
	// can be typed over immediately. On a blank line it replaces the line;
	// otherwise it goes below the current line.
	function insertCallout(view: EditorView) {
		const head = view.state.selection.main.head;
		const line = view.state.doc.lineAt(head);
		const onBlank = line.text.trim() === '';
		const pos = onBlank ? line.from : line.to;
		const insert = `${onBlank ? '' : '\n'}> [!note] Title\n> `;
		const titleFrom = pos + (onBlank ? 0 : 1) + '> [!note] '.length;
		view.dispatch({
			changes: onBlank ? { from: line.from, to: line.to, insert } : { from: pos, insert },
			selection: { anchor: titleFrom, head: titleFrom + 'Title'.length }
		});
		view.focus();
	}

	export function runCommand(name: string) {
		if (!view) return;
		if (name === 'preview') {
			setPreviewMode(view, true);
			view.contentDOM.blur();
			return;
		}
		COMMANDS[name]?.(view);
	}

	// Yank flash: every vim yank posts a "<N> lines yanked" notice into the
	// status panel, announced on the facade's "dialog" signal. The notice
	// fires inside the yank operation, before any selection collapse
	// dispatch, so the live selection is still the visual range for visual
	// yanks; operator yanks (`yy`, `yG`, ...) see a collapsed cursor and
	// cover N lines down from the pre-op cursor line instead. Reading live
	// state (never a stashed range) keeps a stale selection from painting
	// the wrong lines.
	function onVimDialog() {
		if (!view || !get(settings).editor.vimMotions) return;
		// Read only the newest notice: an older one can still be mounted
		// within its 1500ms lifetime and would poison the line count.
		const messages = view.dom.querySelectorAll('.cm-vim-panel .cm-vim-message');
		const text = messages.length ? messages[messages.length - 1].textContent : null;
		const m = text ? YANK_NOTICE.exec(text) : null;
		if (!m) return;
		const count = Math.max(1, parseInt(m[1], 10));
		const sel = view.state.selection.main;
		let from: number;
		let to: number;
		if (sel.empty) {
			const headLine = view.state.doc.lineAt(sel.head).number;
			from = Math.min(prevCursorLine, headLine);
			to = from + count - 1;
		} else {
			from = view.state.doc.lineAt(Math.min(sel.anchor, sel.head)).number;
			to = view.state.doc.lineAt(Math.max(sel.anchor, sel.head)).number;
		}
		view.dispatch({ effects: addYankFlash.of({ from, to }) });
		clearTimeout(yankTimer);
		yankTimer = setTimeout(() => {
			view?.dispatch({ effects: clearYankFlash.of() });
		}, YANK_FLASH_MS);
	}

	// Resolve relative image URLs against the folder of the open note.
	$effect(() => {
		if (!view) return;
		const dir = notePath ? notePath.split('/').slice(0, -1).join('/') || null : null;
		view.dispatch({ effects: noteDirEffect.of(dir) });
	});

	// Feed the vault-wide link context (flat note list + open note) to the
	// wikilink decorations and `[[` completion. Reads $tree so creating or
	// deleting a note re-resolves links without an edit.
	$effect(() => {
		if (!view) return;
		const notes = notePathsFromTree($tree);
		view.dispatch({ effects: wikiCtxEffect.of({ notes, current: notePath ?? null }) });
	});

	// Feed the vault-wide tag list to `#` completion. Refetches when the
	// tree changes (create/rename/delete/save), same trigger as wikiCtx.
	$effect(() => {
		if (!view) return;
		$tree;
		const v = view;
		fetch('/api/tags')
			.then((res) => (res.ok ? res.json() : []))
			.then((data: Array<{ tag: string; count: number }> | string[]) => {
				const tags = Array.isArray(data)
					? data.map((d) => (typeof d === 'string' ? d : d.tag))
					: [];
				v.dispatch({ effects: tagCtxEffect.of(tags) });
			})
			.catch(() => {});
	});

	// Markdown image links are note-relative (livePreview resolves them against
	// the note's folder); the upload API returns vault-relative paths. Convert
	// so nested notes don't get doubled paths.
	function noteRelative(notePath: string, vaultRel: string): string {
		const from = notePath.split('/').slice(0, -1).filter(Boolean);
		const to = vaultRel.split('/').filter(Boolean);
		let i = 0;
		while (i < from.length && i < to.length && from[i] === to[i]) i++;
		return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/') || vaultRel;
	}

	async function uploadImage(file: File): Promise<string | null> {
		const form = new FormData();
		form.append('file', file);
		// Resolve where this attachment should land from the user's settings and
		// the current note's folder; the server re-validates the path.
		const noteDir = notePath ? notePath.split('/').slice(0, -1).join('/') || null : null;
		const folder = attachmentDirFor(noteDir, get(settings).attachments);
		if (folder) form.append('folder', folder);
		try {
			const res = await fetch('/api/attachments', { method: 'POST', body: form });
			if (!res.ok) return null;
			const data = await res.json();
			return typeof data.path === 'string' ? data.path : null;
		} catch {
			return null;
		}
	}

	// Upload pasted images and insert their markdown reference at the cursor.
	// Failed uploads are skipped silently rather than leaving broken refs.
	async function insertImages(view: EditorView, files: File[]) {
		let insert = '';
		for (const file of files) {
			const vaultRel = await uploadImage(file);
			if (!vaultRel) continue;
			const rel = notePath ? noteRelative(notePath, vaultRel) : vaultRel;
			const name = file.name.replace(/\.[^.]+$/, '') || 'image';
			insert += `![${name}](${rel})\n`;
		}
		if (!insert) return;
		const pos = view.state.selection.main.head;
		const line = view.state.doc.lineAt(pos);
		const needsBreak = pos > line.from;
		view.dispatch({
			changes: { from: pos, insert: needsBreak ? `\n${insert}` : insert },
			selection: { anchor: pos + insert.length + (needsBreak ? 1 : 0) }
		});
	}

	onMount(() => {
		const initialSettings = get(settings);
		view = new EditorView({
			doc: value,
			parent: container,
			extensions: [
				// Vim motions go first so normal-mode keys win over the
				// insert-mode helpers below (Enter/Tab/Space bail out via
				// inVimNormal anyway). The status panel is the mode indicator.
				vimCompartment.of(initialSettings.editor.vimMotions ? vim({ status: true }) : []),
				// Visible selection in vim visual mode: the vim theme blanks
				// native selection, so restore the theme selection color. The
				// doubled class outranks vim's rule however the equal-
				// precedence themes order; cm-vimMode only exists outside
				// insert mode so insert behavior is untouched.
				Prec.highest(
					EditorView.theme({
						'& .cm-vimMode.cm-vimMode .cm-line': {
							'&::selection': { backgroundColor: 'var(--selection-bg) !important' },
							'& ::selection': { backgroundColor: 'var(--selection-bg) !important' }
						}
					})
				),
				history(),
				keymap.of([
					{ key: 'Mod-b', run: toggleWrap('**') },
					{ key: 'Mod-i', run: toggleWrap('*') },
					{ key: 'Mod-Shift-x', run: toggleWrap('~~') },
					{ key: 'Mod-`', run: toggleWrap('`') },
					{ key: 'Mod-1', run: setHeading(1) },
					{ key: 'Mod-2', run: setHeading(2) },
					{ key: 'Mod-3', run: setHeading(3) },
					{ key: 'Mod-4', run: setHeading(4) },
					{ key: 'Mod-5', run: setHeading(5) },
					{ key: 'Mod-6', run: setHeading(6) },
					{ key: 'Mod-Shift-b', run: toggleBullet },
					{ key: 'Mod-l', run: toggleTask },
					{ key: 'Mod-Shift-l', run: removeTask },
					{
						key: 'Mod-m',
						run: (view) => {
							wrapMathInline(view);
							return true;
						}
					},
					{
						key: 'Mod-Shift-e',
						run: (view) => {
							insertMathBlock(view);
							return true;
						}
					}
				]),
				keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
				// Tab indents in insert mode; in vim normal mode the key is
				// left alone so vim owns it.
				keymap.of([
					{ key: 'Tab', run: (view) => (inVimNormal(view) ? false : (indentWithTab.run?.(view) ?? false)) }
				]),
				// Heading folding: gutter chevrons plus keyboard, ranges from
				// folding.ts (ATX only, fences and frontmatter excluded).
				foldGutter({ openText: '▾', closedText: '▸' }),
				foldService.of((state, lineStart) => {
					const doc = state.doc.toString();
					const lineNo = state.doc.lineAt(lineStart).number;
					const fold = headingFoldRange(doc, lineNo) ?? listFoldRange(doc, lineNo);
					if (fold) return fold;
					// Callout bodies fold from a `-`/`+` header; single-line
					// callouts have nothing to fold.
					for (const c of findCallouts(state)) {
						if (c.firstLine === lineNo && c.fold !== '' && c.lastLine > c.firstLine) {
							return { from: state.doc.line(c.firstLine).to, to: state.doc.line(c.lastLine).to };
						}
					}
					return null;
				}),
				// Snippet triggers run before indent; both fall through when the
				// cursor is not on a trigger in math. Completion's own Enter
				// (highest precedence) still wins when its panel is open.
				Prec.high(
					keymap.of([
						{
							key: 'Enter',
							run: (view) => (inVimNormal(view) ? false : insertListNewline(view))
						},
						// With a completion panel open (math `\` or `[[`),
						// Tab cycles suggestions and Enter accepts; otherwise
						// both fall through to snippet/indent behaviour.
						{
							key: 'Tab',
							run: (view) => {
								if (completionStatus(view.state) === 'active') {
									return moveCompletionSelection(true)(view);
								}
								return false;
							}
						},
						{
							key: 'Shift-Tab',
							run: (view) => {
								if (completionStatus(view.state) === 'active') {
									return moveCompletionSelection(false)(view);
								}
								return false;
							}
						},
						{ key: 'Tab', run: (view) => (inVimNormal(view) ? false : expandMathSnippet(view)) },
						{ key: ' ', run: (view) => (inVimNormal(view) ? false : expandMathFraction(view)) }
					])
				),
				search({ top: true }),
				highlightSelectionMatches({ minSelectionLength: 2 }),
				markdownLanguage(),
				codeHighlight,
				autocompletion({ icons: false }),
				noteDirField,
				wikiCtxField,
				tagCtxField,
				livePreview,
				mathBlockField,
				yankFlashField,
				yankFlashTheme,
				baseTheme,
				fontSizeCompartment.of(themeForFontSize(initialSettings.editor.fontSize)),
				lineNumbersCompartment.of(initialSettings.editor.showLineNumbers ? lineNumbers() : []),
				wrapCompartment.of(initialSettings.editor.wordWrap ? EditorView.lineWrapping : []),
				EditorView.domEventHandlers({
					keydown: (e, view) => {
						if (e.key === 'Escape') {
							// An open completion list gets first claim on Esc -
							// closing it must not also flip to full preview.
							if (completionStatus(view.state)) {
								closeCompletion(view);
								e.preventDefault();
								return true;
							}
							// With vim motions on, Esc in insert/visual mode drops
							// to normal mode inside the vim extension (focus is
							// kept); only normal-mode Esc enters full preview.
							// Returning false lets vim claim the key.
							if (get(settings).editor.vimMotions) {
								const vimState = getCM(view)?.state.vim;
								if (vimState && (vimState.insertMode || vimState.visualMode)) return false;
							}
							// Full preview: render the whole note, stop the cursor
							// blinking. Click back into the editor to resume editing.
							e.preventDefault();
							setPreviewMode(view, true);
							view.contentDOM.blur();
						}
					},
					mousedown: (e, view) => {
						if (isPreviewMode()) setPreviewMode(view, false);
						// Ctrl/Cmd+click on a link: stop CodeMirror from adding a
						// multi-cursor selection so the click can open the tab.
						if (e.ctrlKey || e.metaKey) {
							const pos = view.posAtCoords(e);
							if (pos !== null && urlAtPos(view, pos)) return true;
						}
					},
					click: (e, view) => {
						// Ctrl/Cmd+click on a link opens it in a new tab. A plain
						// click keeps the normal editor behaviour (cursor placement).
						if (e.ctrlKey || e.metaKey) {
							const pos = view.posAtCoords(e);
							if (pos !== null) {
								const url = urlAtPos(view, pos);
								if (url) {
									e.preventDefault();
									window.open(url, '_blank', 'noopener,noreferrer');
									return true;
								}
							}
						}
					},
					paste: (e, view) => {
						// Paste an image from the clipboard: upload it to the vault
						// and insert the markdown reference. Non-image pastes keep
						// the default behaviour.
						const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
							f.type.startsWith('image/')
						);
						if (!files.length) return false;
						e.preventDefault();
						void insertImages(view, files);
						return true;
					}
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !suppressChange) {
						onChange(update.state.doc.toString());
					}
					// Yank-flash bookkeeping: the cursor line, so operator yanks
					// can cover N lines from where the motion started.
					if (get(settings).editor.vimMotions) {
						prevCursorLine = update.state.doc.lineAt(update.state.selection.main.head).number;
					}
				})
			]
		});

		const unsubscribe = settings.subscribe((s) => {
			if (!view) return;
			view.dispatch({
				effects: [
					fontSizeCompartment.reconfigure(themeForFontSize(s.editor.fontSize)),
					lineNumbersCompartment.reconfigure(s.editor.showLineNumbers ? lineNumbers() : []),
					wrapCompartment.reconfigure(s.editor.wordWrap ? EditorView.lineWrapping : []),
					vimCompartment.reconfigure(s.editor.vimMotions ? vim({ status: true }) : [])
				]
			});
		});

		// Yank notices arrive on the vim facade's "dialog" signal. The facade
		// exists once the vim plugin is constructed alongside the view.
		getCM(view)?.on('dialog', onVimDialog);

		return () => unsubscribe();
	});

	// If the parent swaps to a different note, reset the doc without treating
	// it as a user edit (no spurious save).
	export function setDoc(newValue: string, resetCursor = false) {
		if (!view) return;
		suppressChange = true;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: newValue },
			// Note switches park the cursor on line 1; same-note pushes
			// (rename syncs, link conversions) leave it alone.
			selection: resetCursor ? { anchor: 0 } : undefined,
			effects: resetCursor ? [EditorView.scrollIntoView(0)] : []
		});
		// Note switches also take focus so typing starts immediately.
		if (resetCursor) view.focus();
		suppressChange = false;
	}

	// Jump the cursor to a 1-based line (outline navigation): place the
	// caret at its start and center it in view.
	export function gotoLine(lineNo: number) {
		if (!view) return;
		if (lineNo < 1 || lineNo > view.state.doc.lines) return;
		const line = view.state.doc.line(lineNo);
		view.dispatch({
			selection: { anchor: line.from },
			effects: EditorView.scrollIntoView(line.from, { y: 'center' })
		});
		view.focus();
	}

	// Keyboard focus from the Space leader: leave full preview first so the
	// cursor lands back in the text instead of a blurred preview.
	export function focus() {
		if (!view) return;
		if (isPreviewMode()) setPreviewMode(view, false);
		view.focus();
	}

	// App-level Esc while the editor is blurred in full preview: unhide the
	// marks and take focus back, so normal-mode Esc never strands keyboard
	// flow on the mouse. Returns whether it handled anything.
	export function exitPreview(): boolean {
		if (!view || !isPreviewMode()) return false;
		setPreviewMode(view, false);
		view.focus();
		return true;
	}

	// Keep the editor in sync whenever the parent's value changes, so the doc
	// can never go stale even if setDoc's timing races the editor mount.
	$effect(() => {
		const content = value;
		if (view && view.state.doc.toString() !== content) {
			suppressChange = true;
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: content }
			});
			suppressChange = false;
		}
	});

	onDestroy(() => {
		clearTimeout(yankTimer);
		view?.destroy();
	});
</script>

<div class="editor-host" bind:this={container}></div>

<style>
	.editor-host {
		height: 100%;
		overflow-y: auto;
	}
</style>
