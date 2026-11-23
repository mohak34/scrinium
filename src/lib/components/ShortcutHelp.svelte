<script lang="ts">
	import { SHORTCUTS as sections } from '$lib/shortcuts';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();
</script>

<div class="overlay" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onClose()}>
	<div class="help" role="dialog" aria-label="Keyboard shortcuts">
		<div class="head">
			<span class="title">Keyboard shortcuts</span>
			<button class="icon-btn" title="Close (Esc)" onclick={onClose}>
				<span class="material-symbols-outlined">close</span>
			</button>
		</div>
		{#each sections as sec (sec.title)}
			<div class="section">
				<div class="section-title">{sec.title}</div>
				{#each sec.rows as row (row.keys + row.desc)}
					<div class="row">
						<span class="desc">{row.desc}</span>
						<kbd class="kbd">{row.keys}</kbd>
					</div>
				{/each}
			</div>
		{/each}
		<div class="foot">
			Vim keys (Space, ?, /, [, ], j k h l) only act outside text inputs, so they never clash with browser
			shortcuts. Toggle them in Settings, Keyboard.
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 940;
		background: var(--scrim);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 12vh;
	}
	.help {
		width: min(440px, 90vw);
		max-height: 70vh;
		overflow-y: auto;
		background: var(--menu);
		border-radius: var(--r-xl);
		box-shadow: var(--menu-shadow);
		padding: 12px 16px 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.title {
		font: 600 var(--fs-lg) var(--font-ui);
		color: var(--text);
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.section {
		margin-top: 12px;
	}
	.section-title {
		font: 600 var(--fs-sm) var(--font-ui);
		color: var(--text-3);
		margin-bottom: 2px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
		border-top: 1px solid var(--line);
	}
	.desc {
		font-size: var(--t-meta);
		color: var(--text-2);
	}
	.foot {
		margin-top: 12px;
		font-size: var(--t-caption);
		color: var(--text-3);
		line-height: 1.5;
	}
</style>
