<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import CodeEditor from '$lib/editor/CodeEditor.svelte';
	import { activePath, loadTree, loadNote, scheduleSave, flushSave } from '$lib/stores/vault';

	let editorRef = $state<CodeEditor>();
	let currentContent = $state('');

	onMount(() => {
		loadTree();
		// Best-effort: save any pending edits if the tab is closed mid-debounce.
		window.addEventListener('pagehide', () => {
			void flushSave();
		});
	});

	async function openNote(path: string) {
		// Finish saving the current note before swapping, so the debounce never
		// drops edits made right before switching.
		await flushSave();
		activePath.set(path);
		currentContent = await loadNote(path);
		editorRef?.setDoc(currentContent);
	}

	function onChange(newContent: string) {
		currentContent = newContent;
		const path = get(activePath);
		if (path) scheduleSave(path, newContent);
	}
</script>

<div class="layout">
	<Sidebar onSelect={openNote} />
	<div class="main">
		<TopBar path={$activePath} />
		{#if $activePath}
			<CodeEditor bind:this={editorRef} value={currentContent} {onChange} />
		{:else}
			<div class="empty">Select a note, or create one from the sidebar.</div>
		{/if}
	</div>
</div>

<style>
	.layout {
		display: flex;
		height: 100vh;
	}
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #6b6e7a;
		font-family: system-ui, sans-serif;
		font-size: 0.9rem;
	}
</style>
