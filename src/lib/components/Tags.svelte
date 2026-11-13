<script lang="ts">
	import { uniqueTagNames } from '$lib/editor/tags';
	import { parseFrontmatter, frontmatterTags } from '$lib/editor/frontmatter';
	import { searchTagRequest } from '$lib/stores/actions';
	import PanelSection from './PanelSection.svelte';

	interface Props {
		content: string;
	}
	let { content }: Props = $props();

	// `tags:` key first (note-level metadata), then inline `#tags`.
	const tags = $derived.by(() => {
		const seen = new Set<string>();
		const fm = parseFrontmatter(content);
		if (fm) for (const t of frontmatterTags(fm.data)) seen.add(t);
		for (const t of uniqueTagNames(content)) seen.add(t);
		return [...seen];
	});
</script>

{#if tags.length > 0}
	<PanelSection icon="sell" title="Tags">
		<div class="tags">
			{#each tags as t (t)}
				<button onclick={() => searchTagRequest.set(t)} title={`Search #${t}`}><span class="hash">#</span>{t}</button>
			{/each}
		</div>
	</PanelSection>
{/if}

<style>
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 4px;
	}
	button {
		border: none;
		border-radius: 5px;
		padding: 2px 7px;
		background: var(--inset);
		box-shadow: inset 0 0 0 1px var(--rim);
		color: var(--text-2);
		font: var(--fs-sm) var(--font-ui);
		cursor: pointer;
	}
	button:hover {
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--text-4);
	}
	.hash {
		color: var(--text-4);
	}
</style>
