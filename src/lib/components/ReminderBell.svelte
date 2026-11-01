<script lang="ts">
	import { reminders, remindersOpen } from '$lib/stores/reminders';

	// Bottom-bar count of waiting reminders; toggles the reminder panel.
</script>

{#if $reminders.length > 0}
	<button
		class="bell"
		class:on={$remindersOpen}
		onclick={() => remindersOpen.update((o) => !o)}
		title="Reminders"
		aria-label="{$reminders.length} reminders"
	>
		<span class="material-symbols-outlined fill">notifications</span>{$reminders.length}
	</button>
{/if}

<style>
	.bell {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 18px;
		padding: 0 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--orange);
		font: inherit;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	.bell .material-symbols-outlined {
		font-size: 14px;
	}
	.bell:hover,
	.bell.on {
		background: var(--hover);
	}
	.bell:focus-visible {
		outline: 1px solid var(--accent);
	}
</style>
