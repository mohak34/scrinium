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
				<button onclick={() => searchTagRequest.set(t)} title={`Search #${t}`}>#{t}</button>
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
		border-radius: var(--r-sm);
		padding: 2px 7px;
		background: color-mix(in srgb, var(--violet) 12%, transparent);
		color: var(--violet);
		font: var(--fs-sm) var(--font-ui);
		cursor: pointer;
	}
	button:hover {
		background: color-mix(in srgb, var(--violet) 22%, transparent);
	}
</style>
