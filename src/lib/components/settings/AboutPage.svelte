<script lang="ts">
	import { settings } from '$lib/stores/settings';
	import { tree, trashEntries, type VaultEntry } from '$lib/stores/vault';

	function count(entries: VaultEntry[]): { notes: number; folders: number } {
		let notes = 0;
		let folders = 0;
		for (const e of entries) {
			if (e.type === 'directory') {
				folders++;
				const sub = count(e.children ?? []);
				notes += sub.notes;
				folders += sub.folders;
			} else if (e.name.endsWith('.md')) notes++;
		}
		return { notes, folders };
	}
	const stats = $derived(count($tree));

	function reset() {
		if (confirm('Reset editor, keyboard and attachment preferences to defaults?')) settings.reset();
	}
</script>

<div class="stats">
	<div><b>{stats.notes}</b><small>notes</small></div>
	<div><b>{stats.folders}</b><small>folders</small></div>
	<div><b>{$trashEntries.length}</b><small>in trash</small></div>
</div>
<div class="row">
	<div class="txt">
		<span class="lbl">Plain files</span>
		<span class="hint">Every note is a .md file under VAULT_DIR. The sqlite cache can be deleted and rebuilt.</span>
	</div>
</div>
<div class="row">
	<div class="txt">
		<span class="lbl">Reset preferences</span>
		<span class="hint">Editor, keyboard and attachment settings in this browser</span>
	</div>
	<button class="btn" onclick={reset}>Reset</button>
</div>

<style>
	.stats {
		display: flex;
		gap: 36px;
		padding: 20px 0 16px;
		border-bottom: 1px solid var(--line);
	}
	.stats div {
		display: flex;
		flex-direction: column;
	}
	.stats b {
		font: 600 22px var(--font-ui);
	}
	.stats small {
		color: var(--text-3);
		font-size: var(--fs-xs);
	}
</style>
