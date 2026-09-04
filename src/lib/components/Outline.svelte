<script lang="ts">
	import { parseOutline } from '$lib/editor/outline';

	interface Props {
		content: string;
		onJump: (line: number) => void;
	}
	let { content, onJump }: Props = $props();

	const entries = $derived(parseOutline(content));
</script>

{#if entries.length > 0}
	<section aria-label="Outline">
		<header>
			<span class="title">Outline</span>
		</header>
		<ul>
			{#each entries as e (e.line)}
				<li>
					<button
						onclick={() => onJump(e.line)}
						title={e.text}
						style="padding-left: {(e.level - 1) * 10}px"
					>
						<span class="htext">{e.text}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	section {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex-shrink: 0;
		max-height: 40%;
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
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	li button {
		display: block;
		width: 100%;
		background: none;
		border: none;
		border-radius: var(--radius);
		padding-top: 0.2rem;
		padding-bottom: 0.2rem;
		padding-right: 0.3rem;
		cursor: pointer;
		text-align: left;
	}
	li button:hover {
		background: var(--surface-container-low);
	}
	li button:hover .htext {
		color: var(--primary);
	}
	.htext {
		display: block;
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
