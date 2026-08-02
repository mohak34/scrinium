<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap, highlightActiveLine } from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { markdownLanguage, baseTheme } from './markdownSetup';
	import { livePreview } from './livePreview';

	interface Props {
		value: string;
		onChange: (value: string) => void;
	}
	let { value, onChange }: Props = $props();

	let container: HTMLDivElement;
	let view: EditorView | undefined;
	let suppressChange = false;

	onMount(() => {
		view = new EditorView({
			doc: value,
			parent: container,
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				markdownLanguage(),
				livePreview,
				baseTheme,
				highlightActiveLine(),
				EditorView.lineWrapping,
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !suppressChange) {
						onChange(update.state.doc.toString());
					}
				})
			]
		});
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
