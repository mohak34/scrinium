<script lang="ts">
	import { parseOutline } from '$lib/editor/outline';
	import { cursorPos } from '$lib/stores/editor';
	import PanelSection from './PanelSection.svelte';

	interface Props {
		content: string;
		onJump: (line: number) => void;
	}
	let { content, onJump }: Props = $props();

	const entries = $derived(parseOutline(content));
	// The heading the caret sits under lights up as you move through the note.
	const current = $derived.by(() => {
		let line = -1;
		for (const e of entries) if (e.line <= $cursorPos.line) line = e.line;
		return line;
	});
	const minLevel = $derived(Math.min(...entries.map((e) => e.level)));
</script>

{#if entries.length > 0}
	<PanelSection icon="toc" title="Outline">
		<ul>
			{#each entries as e (e.line)}
				<li>
					<button
						class:on={e.line === current}
						onclick={() => onJump(e.line)}
						title={e.text}
						style="padding-left: {10 + (e.level - minLevel) * 14}px"
					>
						{e.text}
					</button>
				</li>
			{/each}
		</ul>
	</PanelSection>
{/if}

<style>
	ul {
		list-style: none;
		margin: 2px 0 0 6px;
		padding: 0;
		border-left: 1px solid var(--line-2);
	}
	button {
		display: block;
		width: 100%;
		margin-left: -1px;
		padding-top: 4px;
		padding-bottom: 4px;
		padding-right: 8px;
		border: none;
		border-left: 1px solid transparent;
		border-radius: 0 var(--r) var(--r) 0;
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	button:hover {
		background: var(--hover);
		color: var(--text);
	}
	button.on {
		color: var(--accent);
		border-left-color: var(--accent);
	}
</style>
