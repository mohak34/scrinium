<script lang="ts">
	import { openSettings } from '$lib/stores/settingsDialog';
	import { openBins } from '$lib/stores/bins';
	import { signOut } from '$lib/auth-client';

	// Archive, Trash, Settings and Sign out: the bottom-left buttons on Notes,
	// Tasks and Board.
</script>

<button class="icon-btn" title="Archive" onclick={() => openBins('archive')}>
	<span class="material-symbols-outlined">inventory_2</span>
</button>
<button class="icon-btn" title="Trash" onclick={() => openBins('trash')}>
	<span class="material-symbols-outlined">delete</span>
</button>
<button class="icon-btn" title="Settings" onclick={() => openSettings()}>
	<span class="material-symbols-outlined">settings</span>
</button>
<button class="icon-btn" title="Sign out" onclick={signOut}>
	<span class="material-symbols-outlined">logout</span>
</button>

<style>
	.icon-btn {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
		flex-shrink: 0;
	}
	.icon-btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.icon-btn .material-symbols-outlined {
		font-size: 16px;
	}
</style>
