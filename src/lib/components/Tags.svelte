<script lang="ts">
	import { uniqueTagNames } from '$lib/editor/tags';
	import { parseFrontmatter, frontmatterTags } from '$lib/editor/frontmatter';
	import { searchTagRequest } from '$lib/stores/actions';

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
	<section aria-label="Tags">
		<header>
			<span class="title">Tags</span>
		</header>
		<div class="pills">
			{#each tags as t (t)}
				<button onclick={() => searchTagRequest.set(t)} title={`Search #${t}`}>
					<span class="pill">#{t}</span>
				</button>
			{/each}
		</div>
	</section>
{/if}

<style>
	section {
		display: flex;
		flex-direction: column;
		flex: none;
		max-height: 30%;
		padding: 1rem var(--gutter) 0;
		overflow-y: auto;
	}
	header {
		display: flex;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.title {
		font-size: var(--font-ui-small);
		line-height: var(--font-ui-small-lh);
		font-weight: 600;
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--on-surface-variant);
		flex: 1;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.pills button {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	.pill {
		display: inline-block;
		font-size: var(--font-ui-micro);
		color: var(--primary);
		background: rgba(181, 196, 255, 0.12);
		padding: 0.15em 0.6em;
		border-radius: 999px;
	}
	.pills button:hover .pill {
		background: rgba(181, 196, 255, 0.22);
	}
</style>
