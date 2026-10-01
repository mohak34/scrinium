<script lang="ts">
	import { saveStatus } from '$lib/stores/vault';
	import { settings } from '$lib/stores/settings';
	import { vimMode, VIM_MODE_LABEL } from '$lib/stores/vim';
	import { cursorPos } from '$lib/stores/editor';
	import { stripFrontmatter } from '$lib/editor/frontmatter';

	// Bottom strip of the notes view: position and size on the right, then
	// save state and the vim mode at the far end where the eye lands last.
	interface Props {
		content: string;
	}
	let { content }: Props = $props();

	// Body words only: frontmatter and fenced code are not prose.
	const words = $derived(
		stripFrontmatter(content)
			.replace(/```[\s\S]*?(```|$)/g, ' ')
			.match(/[\p{L}\p{N}']+/gu)?.length ?? 0
	);

	const saveLabel: Record<string, string> = {
		idle: 'Saved',
		saving: 'Saving',
		saved: 'Saved',
		error: 'Not saved'
	};
</script>

<footer class="status">
	<span class="sp"></span>
	<span>Ln {$cursorPos.line}, Col {$cursorPos.col}</span>
	<span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
	<span class="save {$saveStatus}" title="Save status"><i></i>{saveLabel[$saveStatus]}</span>
	{#if $settings.editor.vimMotions}
		<span class="mode mode-{$vimMode}" title="Vim mode">{VIM_MODE_LABEL[$vimMode]}</span>
	{/if}
</footer>

<style>
	.status {
		height: 26px;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 0 14px;
		border-top: 1px solid var(--line);
		background: var(--panel);
		color: var(--text-3);
		font-size: var(--fs-xs);
		flex-shrink: 0;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.sp {
		flex: 1;
	}
	.save {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.save i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--green);
	}
	.save.saving i {
		background: var(--text-3);
	}
	.save.error {
		color: var(--red);
	}
	.save.error i {
		background: var(--red);
	}
	.mode {
		font: 600 10.5px/17px var(--font-mono);
		letter-spacing: 0.04em;
		padding: 0 6px;
		border-radius: 3px;
		color: var(--text-2);
		border: 1px solid var(--line-2);
	}
	.mode-normal {
		color: var(--on-accent);
		background: var(--accent-fill);
		border-color: var(--accent-fill);
	}
	.mode-visual,
	.mode-visual-line,
	.mode-visual-block {
		color: #1a1408;
		background: var(--yellow);
		border-color: var(--yellow);
	}
	.mode-replace {
		color: #1a0a0c;
		background: var(--red);
		border-color: var(--red);
	}
</style>
