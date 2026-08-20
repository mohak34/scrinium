<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { EditorState, Compartment } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers } from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { settings } from '$lib/stores/settings';
	import {
	openSearchPanel,
	replaceNext,
	search,
	searchKeymap,
	highlightSelectionMatches
} from '@codemirror/search';
	import { markdownLanguage, baseTheme } from './markdownSetup';
	import { livePreview, setPreviewMode, isPreviewMode, urlAtPos, noteDirEffect, noteDirField } from './livePreview';
	import { toggleWrap, setHeading, toggleBullet, toggleTask, removeTask } from './formatting';

	interface Props {
		value: string;
		onChange: (value: string) => void;
		notePath?: string;
	}
	let { value, onChange, notePath }: Props = $props();

	let container: HTMLDivElement;
	let view: EditorView | undefined;
	let suppressChange = false;

	// Compartments so settings (font size, gutters, wrapping) can be reconfigured
	// without recreating the whole editor.
	const lineNumbersCompartment = new Compartment();
	const wrapCompartment = new Compartment();
	const fontSizeCompartment = new Compartment();

	function themeForFontSize(size: number) {
		return EditorView.theme({
			'&': { fontSize: `${size}px` }
		});
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
		replace: replaceNext
	};

	export function runCommand(name: string) {
		if (!view) return;
		if (name === 'preview') {
			setPreviewMode(view, true);
			view.contentDOM.blur();
			return;
		}
		COMMANDS[name]?.(view);
	}

	// Resolve relative image URLs against the folder of the open note.
	$effect(() => {
		if (!view) return;
		const dir = notePath ? notePath.split('/').slice(0, -1).join('/') || null : null;
		view.dispatch({ effects: noteDirEffect.of(dir) });
	});

	async function uploadImage(file: File): Promise<string | null> {
		const form = new FormData();
		form.append('file', file);
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
			const rel = await uploadImage(file);
			if (!rel) continue;
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
					{ key: 'Mod-Shift-l', run: removeTask }
				]),
				keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
				search({ top: true }),
				highlightSelectionMatches({ minSelectionLength: 2 }),
				markdownLanguage(),
				noteDirField,
				livePreview,
				baseTheme,
				fontSizeCompartment.of(themeForFontSize(initialSettings.editor.fontSize)),
				lineNumbersCompartment.of(initialSettings.editor.showLineNumbers ? lineNumbers() : []),
				wrapCompartment.of(initialSettings.editor.wordWrap ? EditorView.lineWrapping : []),
				EditorView.domEventHandlers({
					keydown: (e, view) => {
						if (e.key === 'Escape') {
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
				})
			]
		});

		const unsubscribe = settings.subscribe((s) => {
			if (!view) return;
			view.dispatch({
				effects: [
					fontSizeCompartment.reconfigure(themeForFontSize(s.editor.fontSize)),
					lineNumbersCompartment.reconfigure(s.editor.showLineNumbers ? lineNumbers() : []),
					wrapCompartment.reconfigure(s.editor.wordWrap ? EditorView.lineWrapping : [])
				]
			});
		});

		return () => unsubscribe();
	});

	// If the parent swaps to a different note, reset the doc without treating
	// it as a user edit (no spurious save).
	export function setDoc(newValue: string) {
		if (!view) return;
		suppressChange = true;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: newValue }
		});
		suppressChange = false;
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

	onDestroy(() => view?.destroy());
</script>

<div class="editor-host" bind:this={container}></div>

<style>
	.editor-host {
		height: 100%;
		overflow-y: auto;
	}
</style>
