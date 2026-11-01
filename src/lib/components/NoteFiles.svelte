<script lang="ts">
	import { activePath, tree, type VaultEntry } from '$lib/stores/vault';
	import { noteLinks } from '$lib/relink';
	import { wikiResolver, notePathsFromTree } from '$lib/editor/wikilinks';
	import { fileIcon } from '$lib/attachments';
	import PanelSection from './PanelSection.svelte';

	// Files the open note embeds or links (PDFs, images, anything not a
	// note), in the order they appear. Hidden when there are none.
	interface Props {
		content: string;
		onOpen: (path: string) => void;
	}
	let { content, onOpen }: Props = $props();

	const vaultFiles = $derived.by(() => {
		const out = new Set<string>();
		const walk = (es: VaultEntry[]) => {
			for (const e of es) {
				if (e.type === 'directory') walk(e.children ?? []);
				else if (!/\.md$/i.test(e.name)) out.add(e.path);
			}
		};
		walk($tree);
		return out;
	});

	const files = $derived.by(() => {
		const note = $activePath;
		if (!note) return [];
		const links = wikiResolver(notePathsFromTree($tree));
		return [...new Set(noteLinks(content, note, links).map((l) => l.target))].filter((p) => vaultFiles.has(p));
	});

	const noteDir = $derived($activePath?.split('/').slice(0, -1).join('/') ?? '');
</script>

{#if files.length > 0}
	<PanelSection icon="attach_file" title="Files" count={files.length}>
		<ul>
			{#each files as path (path)}
				{@const dir = path.split('/').slice(0, -1).join('/')}
				<li>
					<button onclick={() => onOpen(path)} title={path}>
						<span class="material-symbols-outlined">{fileIcon(path)}</span>
						<span class="name">{path.split('/').pop()}</span>
						{#if dir !== noteDir}<span class="dir">{dir || '/'}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	</PanelSection>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-2);
		font: var(--fs-sm) var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	button:hover {
		background: var(--hover);
		color: var(--text);
	}
	button:focus-visible {
		outline: 1px solid var(--accent);
	}
	.material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dir {
		margin-left: auto;
		padding-left: 8px;
		font-size: var(--fs-xs);
		color: var(--text-3);
		white-space: nowrap;
	}
</style>
