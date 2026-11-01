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
	// Binary search: entries are in line order and the caret moves often.
	const current = $derived.by(() => {
		let lo = 0;
		let hi = entries.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (entries[mid].line <= $cursorPos.line) lo = mid + 1;
			else hi = mid;
		}
		return lo ? entries[lo - 1].line : -1;
	});
	const minLevel = $derived(entries.reduce((m, e) => Math.min(m, e.level), 6));

	// A long outline scrolls in its own box and draws only the rows in view,
	// so a note with thousands of headings opens as fast as a short one.
	const LONG = 200;
	const ROW = 28;
	const long = $derived(entries.length > LONG);
	let scrollTop = $state(0);
	let boxHeight = $state(0);
	const first = $derived(long ? Math.max(0, Math.floor(scrollTop / ROW) - 10) : 0);
	const shown = $derived(long ? entries.slice(first, first + Math.ceil(boxHeight / ROW) + 20) : entries);
</script>

{#if entries.length > 0}
	<PanelSection icon="toc" title="Outline">
		<ul
			class:long
			bind:clientHeight={boxHeight}
			onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
		>
			{#if long}<li class="gap" style="height: {first * ROW}px"></li>{/if}
			{#each shown as e (e.line)}
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
			{#if long}<li class="gap" style="height: {(entries.length - first - shown.length) * ROW}px"></li>{/if}
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
	ul.long {
		max-height: 60vh;
		overflow-y: auto;
	}
	ul.long li {
		height: 28px;
		overflow: hidden;
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
