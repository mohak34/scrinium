<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { cursorPos } from '$lib/stores/editor';
	import { Compartment, Prec } from '@codemirror/state';
	import {
		EditorView,
		keymap,
		lineNumbers,
		highlightActiveLine,
		highlightActiveLineGutter
	} from '@codemirror/view';
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
	import { livePreview, setPreviewMode, isPreviewMode, urlAtPos, resolveAssetUrl, noteDirEffect, noteDirField, wikiCtxEffect, wikiCtxField, tagCtxEffect, tagCtxField } from './livePreview';
	import { notePathsFromTree } from './wikilinks';
	import { attachmentMarkdown } from '$lib/attachments';
	import { tree } from '$lib/stores/vault';
	import { mathBlockField } from './mathBlock';
	import { vimMode, type VimChromeMode } from '$lib/stores/vim';
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
	let vimOn = $state(false);
	let toasts = $state<{ id: number; text: string }[]>([]);
	let toastId = 0;
	let cmdBar = $state<HTMLDivElement>();
	let cmdOpen = $state(false);

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
	// One view serves every note, so undo history is swapped out on a note
	// switch: Ctrl+Z must never pull the previous note's text into this one.
	const historyCompartment = new Compartment();

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
		if (!view) return;
		// Close signals carry no dialog; vim-off leaves a stale facade that
		// never fires again, but guard anyway.
		const dlg = get(settings).editor.vimMotions
			? (getCM(view)?.state.dialog as HTMLElement | null | undefined)
			: null;
		if (!dlg) return;
		if (dlg.querySelector('input')) {
			// `/` search and `:` ex need a visible input. With no status bar
			// the dialog is homeless, so host it in the command line. The
			// adapter removes it on close, which the observer below sees.
			if (dlg.parentElement !== cmdBar) cmdBar?.appendChild(dlg);
			cmdOpen = true;
			return;
		}
		// Confirmations and errors ("1 lines yanked", "No match found"):
		// keep them out of the command line and toast the text instead.
		// Removing the node also keeps vim's own bottom panel permanently
		// empty (hidden via :empty), since it renders for every dialog.
		dlg.remove();
		const msg = dlg.textContent?.trim();
		if (!msg) return;
		pushToast(msg);
		const m = YANK_NOTICE.exec(msg);
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
			// A linewise yank selects [lineStart, nextLineStart): the range
			// end sits exactly on the following line's start, which is a
			// boundary, not a yanked line - step one back in that case.
			const doc = view.state.doc;
			const lo = Math.min(sel.anchor, sel.head);
			const hi = Math.max(sel.anchor, sel.head);
			const hiLine = doc.lineAt(hi);
			from = doc.lineAt(lo).number;
			to = hi > lo && hi === hiLine.from ? hiLine.number - 1 : hiLine.number;
		}
		view.dispatch({ effects: addYankFlash.of({ from, to }) });
		clearTimeout(yankTimer);
		yankTimer = setTimeout(() => {
			view?.dispatch({ effects: clearYankFlash.of() });
		}, YANK_FLASH_MS);
	}

	function pushToast(text: string) {
		const id = ++toastId;
		toasts = [...toasts.slice(-2), { id, text }];
		setTimeout(() => {
			toasts = toasts.filter((t) => t.id !== id);
		}, 1600);
	}

	// Mode tracking, straight from vim's own mode-change signal. The visual
	// sub-mode comes from live state (linewise vs block select).
	function onVimMode(e: { mode: string }) {
		if (e.mode === 'insert') vimMode.set('insert');
		else if (e.mode === 'replace') vimMode.set('replace');
		else if (e.mode === 'visual') {
			const st = view ? getCM(view)?.state.vim : null;
			vimMode.set(st?.visualLine ? 'visual-line' : st?.visualBlock ? 'visual-block' : 'visual');
		} else vimMode.set('normal');
	}

	// Re-read the live mode: signals only fire on transitions, so a note
	// switch (same view, persisted vim state) would otherwise leave a stale
	// readout - e.g. INSERT shown while vim stayed normal.
	function syncVimMode() {
		if (!view) return;
		const st = getCM(view)?.state.vim;
		if (!st) return;
		let next: VimChromeMode = 'normal';
		if (st.insertMode) next = 'insert';
		else if (st.visualMode) next = st.visualLine ? 'visual-line' : st.visualBlock ? 'visual-block' : 'visual';
		vimMode.set(next);
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

	async function uploadFile(file: File): Promise<string | null> {
		// Resolve where this attachment should land from the user's settings and
		// the current note's folder; the server re-validates the path.
		const noteDir = notePath ? notePath.split('/').slice(0, -1).join('/') || null : null;
		const folder = attachmentDirFor(noteDir, get(settings).attachments);
		const query = new URLSearchParams({ name: file.name });
		if (folder) query.set('folder', folder);
		try {
			// Unknown types have file.type '' and would go out with no
			// Content-Type, which makes SvelteKit drop the body.
			const res = await fetch(`/api/attachments?${query}`, {
				method: 'POST',
				body: file,
				headers: { 'Content-Type': file.type || 'application/octet-stream' }
			});
			if (!res.ok) return null;
			const data = await res.json();
			return typeof data.path === 'string' ? data.path : null;
		} catch {
			return null;
		}
	}

	// Upload pasted or dropped files and insert their markdown reference at
	// `pos`. Failed uploads are skipped silently rather than leaving broken
	// refs.
	async function insertFiles(view: EditorView, files: File[], pos: number) {
		let insert = '';
		for (const file of files) {
			const vaultRel = await uploadFile(file);
			if (vaultRel) insert += attachmentMarkdown(vaultRel, notePath ?? null) + '\n';
		}
		if (!insert) return;
		pos = Math.min(pos, view.state.doc.length);
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
				// inVimNormal anyway). No status bar: the mode pill, toasts
				// and command line below replace it.
				vimCompartment.of(initialSettings.editor.vimMotions ? vim() : []),
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
				historyCompartment.of(history()),
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
				lineNumbersCompartment.of(
					initialSettings.editor.showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
				),
				highlightActiveLine(),
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
								// Relative links point into the vault (attachments).
								const url = urlAtPos(view, pos);
								const href = url && resolveAssetUrl(url, view.state.field(noteDirField));
								if (href) {
									e.preventDefault();
									window.open(href, '_blank', 'noopener,noreferrer');
									return true;
								}
							}
						}
					},
					paste: (e, view) => {
						// Paste files from the clipboard: upload them to the vault
						// and insert markdown references. Text pastes keep the
						// default behaviour.
						const files = Array.from(e.clipboardData?.files ?? []);
						if (!files.length) return false;
						e.preventDefault();
						void insertFiles(view, files, view.state.selection.main.head);
						return true;
					},
					drop: (e, view) => {
						const files = Array.from(e.dataTransfer?.files ?? []);
						if (!files.length) return false;
						e.preventDefault();
						const pos = view.posAtCoords(e) ?? view.state.selection.main.head;
						void insertFiles(view, files, pos);
						return true;
					}
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !suppressChange) {
						onChange(update.state.doc.toString());
					}
					if (update.selectionSet || update.docChanged) {
						const head = update.state.selection.main.head;
						const line = update.state.doc.lineAt(head);
						cursorPos.set({ line: line.number, col: head - line.from + 1 });
					}
					// Yank-flash bookkeeping: the cursor line, so operator yanks
					// can cover N lines from where the motion started.
					if (get(settings).editor.vimMotions) {
						prevCursorLine = update.state.doc.lineAt(update.state.selection.main.head).number;
					}
				})
			]
		});

		// Yank notices and `/`/`:` dialogs arrive on the vim facade's
		// "dialog" signal; mode changes on "vim-mode-change". Turning vim off
		// and on builds a new facade, so hook whichever one is live.
		let hooked: ReturnType<typeof getCM> = null;
		const hookVim = () => {
			const cm = view ? getCM(view) : null;
			if (!cm || cm === hooked) return;
			cm.on('dialog', onVimDialog);
			cm.on('vim-mode-change', onVimMode);
			hooked = cm;
		};

		// Vim is only reconfigured when its toggle flips: a fresh vim() on
		// every settings change (font size, wrap) would reset its mode and
		// registers mid-edit.
		let vimWas = initialSettings.editor.vimMotions;
		const unsubscribe = settings.subscribe((s) => {
			if (!view) return;
			const vimChanged = s.editor.vimMotions !== vimWas;
			vimWas = s.editor.vimMotions;
			view.dispatch({
				effects: [
					fontSizeCompartment.reconfigure(themeForFontSize(s.editor.fontSize)),
					lineNumbersCompartment.reconfigure(
						s.editor.showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
					),
					wrapCompartment.reconfigure(s.editor.wordWrap ? EditorView.lineWrapping : []),
					...(vimChanged ? [vimCompartment.reconfigure(s.editor.vimMotions ? vim() : [])] : [])
				]
			});
			vimOn = s.editor.vimMotions;
			hookVim();
			syncVimMode();
		});

		// The adapter removes hosted dialogs on close; an empty command
		// line hides itself.
		const cmdObserver = new MutationObserver(() => {
			cmdOpen = (cmdBar?.childElementCount ?? 0) > 0;
		});
		if (cmdBar) cmdObserver.observe(cmdBar, { childList: true });

		return () => {
			unsubscribe();
			cmdObserver.disconnect();
		};
	});

	// If the parent swaps to a different note, reset the doc without treating
	// it as a user edit (no spurious save). resetCursor marks a note switch:
	// the old note's undo history is dropped with its text.
	export function setDoc(newValue: string, resetCursor = false) {
		if (!view) return;
		suppressChange = true;
		if (resetCursor) view.dispatch({ effects: historyCompartment.reconfigure([]) });
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: newValue },
			// Note switches park the cursor on line 1; same-note pushes
			// (rename syncs, link conversions) leave it alone.
			selection: resetCursor ? { anchor: 0 } : undefined,
			effects: resetCursor ? [EditorView.scrollIntoView(0)] : []
		});
		if (resetCursor) view.dispatch({ effects: historyCompartment.reconfigure(history()) });
		// Note switches also take focus so typing starts immediately.
		if (resetCursor) view.focus();
		suppressChange = false;
		// Same view, persisted vim state: re-read the mode for the readout.
		syncVimMode();
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

	// Note bar eye button: flip full preview either way.
	export function togglePreview() {
		if (!view) return;
		if (isPreviewMode()) exitPreview();
		else runCommand('preview');
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

<div class="editor-wrap">
	<div class="editor-host" bind:this={container}></div>
	{#if vimOn}
		<div class="toasts" aria-live="polite">
			{#each toasts as t (t.id)}
				<div class="toast">{t.text}</div>
			{/each}
		</div>
	{/if}
	<div class="cmdline" class:open={vimOn && cmdOpen} bind:this={cmdBar}></div>
</div>

<style>
	.editor-wrap {
		position: relative;
		height: 100%;
	}
	.editor-host {
		height: 100%;
		overflow-y: auto;
	}
	.toasts {
		position: absolute;
		top: 8px;
		right: 12px;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-end;
		pointer-events: none;
	}
	.toast {
		font-family: var(--font-mono);
		font-size: var(--font-ui-small);
		color: var(--on-surface);
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius);
		box-shadow: var(--shadow-pop);
		padding: 4px 10px;
		max-width: 320px;
	}
	.cmdline {
		display: none;
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 30;
		background: var(--surface-container);
		border-top: 1px solid var(--border-raised);
		padding: 4px 12px;
		font-family: var(--font-mono);
		font-size: var(--font-ui-small);
		color: var(--on-surface);
	}
	.cmdline.open {
		display: block;
	}
	/* The input is injected by the vim extension, outside Svelte markup. */
	.cmdline :global(input) {
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: inherit;
		font: inherit;
		padding: 0;
	}
</style>
