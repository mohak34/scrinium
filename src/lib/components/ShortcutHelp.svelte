<script lang="ts">
	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	interface Row {
		keys: string;
		desc: string;
	}

	const sections: { title: string; rows: Row[] }[] = [
		{
			title: 'File tree',
			rows: [
				{ keys: 'j k / arrows', desc: 'Move between entries' },
				{ keys: 'l', desc: 'Expand folder / first child' },
				{ keys: 'h', desc: 'Collapse folder / parent folder' },
				{ keys: 'Enter', desc: 'Open note / toggle folder' }
			]
		},
		{
			title: 'Leader (Space, then a key)',
			rows: [
				{ keys: 'Space p', desc: 'Command palette' },
				{ keys: 'Space n / N', desc: 'New note / new folder' },
				{ keys: 'Space e', desc: 'Focus editor' },
				{ keys: 'Space f', desc: 'Focus note search' },
				{ keys: 'Space s / r', desc: 'Toggle left / right sidebar' },
				{ keys: 'Space x', desc: 'Close current tab' },
				{ keys: 'Space P', desc: 'Pin / unpin current note' }
			]
		},
		{
			title: 'General',
			rows: [
				{ keys: 'Ctrl/⌘ K', desc: 'Command palette' },
				{ keys: '/', desc: 'Focus note search' },
				{ keys: '?', desc: 'This help' },
				{ keys: 'Esc', desc: 'Close dialog' }
			]
		},
		{
			title: 'Tabs',
			rows: [
				{ keys: '[', desc: 'Previous tab' },
				{ keys: ']', desc: 'Next tab' }
			]
		},
		{
			title: 'Sidebar',
			rows: [{ keys: 'Ctrl/⌘ /', desc: 'Toggle sidebar' }]
		},
		{
			title: 'Editor',
			rows: [
				{ keys: 'Ctrl/⌘ F', desc: 'Find in note' },
				{ keys: 'Ctrl/⌘ B / I', desc: 'Bold / italic' },
				{ keys: 'Esc', desc: 'Normal mode, then full preview' }
			]
		},
		{
			title: 'Editor vim motions',
			rows: [
				{ keys: 'h j k l', desc: 'Move' },
				{ keys: 'i / a', desc: 'Insert before / after cursor' },
				{ keys: 'w b e', desc: 'Word forward / back / end' },
				{ keys: '0 $', desc: 'Line start / end' },
				{ keys: 'gg G', desc: 'Top / bottom of note' },
				{ keys: 'o O', desc: 'New line below / above' },
				{ keys: 'x dd', desc: 'Delete char / line' },
				{ keys: 'yy p', desc: 'Yank line / put' },
				{ keys: 'u', desc: 'Undo' },
				{ keys: 'v', desc: 'Visual mode' }
			]
		}
	];
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
						<kbd>{row.keys}</kbd>
					</div>
				{/each}
			</div>
		{/each}
		<div class="foot">
			Vim keys (/, ?, [, ]) only act outside text inputs, so they never clash with browser
			shortcuts. Toggle them in Settings → Editor.
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 940;
		background: var(--overlay);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 12vh;
	}
	.help {
		width: min(420px, 90vw);
		max-height: 70vh;
		overflow-y: auto;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-pop);
		padding: 12px 16px 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.title {
		font-size: var(--font-ui-medium);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
	}
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface-variant);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.section {
		margin-top: 10px;
	}
	.section-title {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
		margin-bottom: 2px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 5px 0;
		border-top: 1px solid var(--border-default);
	}
	.desc {
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
	}
	kbd {
		font-family: var(--font-mono);
		font-size: var(--font-ui-micro);
		background: var(--surface-container-high);
		border-radius: 4px;
		padding: 1px 6px;
		color: var(--on-surface);
		white-space: nowrap;
	}
	.foot {
		margin-top: 12px;
		font-size: var(--font-ui-micro);
		color: var(--outline);
		line-height: 1.5;
	}
</style>
