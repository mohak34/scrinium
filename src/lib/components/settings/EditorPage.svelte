<script lang="ts">
	import { settings } from '$lib/stores/settings';
	import Toggle from './Toggle.svelte';

	const ed = $derived($settings.editor);
	const MIN = 10;
	const MAX = 24;

	function set<K extends keyof typeof ed>(key: K, value: (typeof ed)[K]) {
		settings.update((s) => ({ ...s, editor: { ...s.editor, [key]: value } }));
	}
</script>

<div class="row">
	<div class="txt"><span class="lbl">Font size</span><span class="hint">Note text in the editor</span></div>
	<div class="stepper">
		<button title="Smaller" disabled={ed.fontSize <= MIN} onclick={() => set('fontSize', ed.fontSize - 1)}>
			<span class="material-symbols-outlined">remove</span>
		</button>
		<span class="v">{ed.fontSize}px</span>
		<button title="Larger" disabled={ed.fontSize >= MAX} onclick={() => set('fontSize', ed.fontSize + 1)}>
			<span class="material-symbols-outlined">add</span>
		</button>
	</div>
</div>
<p class="sample" style="font-size: {ed.fontSize}px">
	The quick brown fox jumps over the lazy dog. <span class="link">Weekly review</span> links stay readable.
</p>
<div class="row">
	<div class="txt"><span class="lbl">Line numbers</span><span class="hint">Gutter on the left of the editor</span></div>
	<Toggle label="Line numbers" on={ed.showLineNumbers} onchange={() => set('showLineNumbers', !ed.showLineNumbers)} />
</div>
<div class="row">
	<div class="txt"><span class="lbl">Word wrap</span><span class="hint">Wrap long lines instead of scrolling sideways</span></div>
	<Toggle label="Word wrap" on={ed.wordWrap} onchange={() => set('wordWrap', !ed.wordWrap)} />
</div>

<style>
	.stepper {
		display: flex;
		align-items: center;
		height: 28px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
	}
	.stepper button {
		width: 28px;
		height: 26px;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		color: var(--text-2);
		cursor: pointer;
	}
	.stepper button:hover:not(:disabled) {
		background: var(--hover);
		color: var(--text);
	}
	.stepper button:disabled {
		color: var(--text-4);
		cursor: default;
	}
	.v {
		min-width: 46px;
		text-align: center;
		font: 500 12px/26px var(--font-mono);
		border-inline: 1px solid var(--line-2);
	}
	.sample {
		margin: 0 0 4px;
		padding: 10px 16px;
		border-left: 2px solid var(--line-2);
		font-family: var(--font-read);
		line-height: 1.75;
		color: var(--text-2);
	}
	.link {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
