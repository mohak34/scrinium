<script lang="ts">
	import { settings } from '$lib/stores/settings';
	import { SHORTCUTS } from '$lib/shortcuts';
	import Toggle from './Toggle.svelte';

	const vim = $derived($settings.editor.vimMotions);
	const toggleVim = () =>
		settings.update((s) => ({ ...s, editor: { ...s.editor, vimMotions: !s.editor.vimMotions } }));
</script>

<div class="row">
	<div class="txt">
		<span class="lbl">Vim motions</span>
		<span class="hint">Vim in the editor, plus single-key shortcuts outside text fields</span>
	</div>
	<Toggle label="Vim motions" on={vim} onchange={toggleVim} />
</div>

{#each SHORTCUTS as sec (sec.title)}
	<h3 class="sub">{sec.title}</h3>
	{#each sec.rows as r (r.keys + r.desc)}
		<div class="key">
			<span>{r.desc}</span>
			<span class="kbd">{r.keys}</span>
		</div>
	{/each}
{/each}

<style>
	.key {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 32px;
		border-bottom: 1px solid var(--line);
		font-size: var(--fs);
		color: var(--text-2);
	}
</style>
