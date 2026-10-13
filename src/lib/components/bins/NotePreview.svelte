<script lang="ts">
	import 'katex/dist/katex.min.css';
	import { loadNote } from '$lib/stores/vault';

	// Read-only render of one vault file for the bins view. path is where the
	// file sits now (".archive/...", ".trash/..." or a live note); renderPath
	// is the path relative images resolve against, which differs for a file
	// archived on its own (its images stayed in the vault).
	let { path, renderPath = path }: { path: string; renderPath?: string } = $props();

	const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
	const isImage = $derived(/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path));

	let html = $state('');
	let status = $state<'loading' | 'ready' | 'error' | 'none'>('loading');

	$effect(() => {
		const p = path;
		const r = renderPath;
		if (!p.endsWith('.md')) {
			status = 'none';
			return;
		}
		let live = true;
		status = 'loading';
		void Promise.all([loadNote(p), import('$lib/print/renderNote')])
			.then(([src, { renderNoteToHtml }]) => {
				if (!live) return;
				html = renderNoteToHtml(src, r);
				status = 'ready';
			})
			.catch(() => {
				if (live) status = 'error';
			});
		return () => {
			live = false;
		};
	});
</script>

{#if isImage}
	<img class="img" src="/api/assets/{enc(path)}" alt="" />
{:else if status === 'none'}
	<div class="msg">No preview for this file type.</div>
{:else if status === 'error'}
	<div class="msg">Could not load this note.</div>
{:else if status === 'ready'}
	<article class="doc">{@html html}</article>
{/if}

<style>
	.msg {
		padding: 28px 0;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.img {
		max-width: 100%;
		margin-top: 24px;
	}
	.doc {
		max-width: 760px;
		padding: 8px 0 48px;
		font: 16px/1.65 var(--font-read);
		color: var(--text);
		overflow-wrap: break-word;
	}
	.doc :global(h1),
	.doc :global(h2),
	.doc :global(h3),
	.doc :global(h4) {
		line-height: 1.3;
		margin: 1.4em 0 0.5em;
	}
	.doc :global(h1) {
		font-size: 1.7em;
	}
	.doc :global(h2) {
		font-size: 1.4em;
	}
	.doc :global(h3) {
		font-size: 1.2em;
	}
	.doc :global(a),
	.doc :global(.print-wikilink),
	.doc :global(.print-tag) {
		color: var(--accent);
	}
	.doc :global(code.print-inline-code) {
		font: 0.88em var(--font-mono);
		background: var(--hover);
		padding: 0.1em 0.35em;
		border-radius: var(--r);
	}
	.doc :global(blockquote) {
		border-left: 3px solid var(--line-3);
		padding: 0.2em 1em;
		margin: 1em 0;
		color: var(--text-2);
	}
	.doc :global(pre.print-code) {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 0.75rem 1rem;
		overflow-x: auto;
		font: 0.85em var(--font-mono);
	}
	.doc :global(.print-code-lang) {
		color: var(--text-3);
		font-size: 0.75em;
		text-transform: uppercase;
		margin-bottom: 0.4rem;
	}
	.doc :global(.print-math) {
		text-align: center;
		margin: 0.9rem 0;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.25em 0;
	}
	.doc :global(.print-math .katex-display) {
		margin: 0;
	}
	.doc :global(img) {
		max-width: 100%;
	}
	.doc :global(.callout) {
		border-left: 3px solid var(--callout-accent, var(--accent));
		background: var(--callout-bg, var(--hover));
		border-radius: var(--r-md);
		padding: 0.6rem 0.9rem;
		margin: 0.9rem 0;
	}
	.doc :global(.callout-title) {
		display: flex;
		align-items: center;
		gap: 0.4em;
		font-weight: 700;
		color: var(--callout-accent, var(--accent));
	}
	.doc :global(.callout-icon) {
		width: 18px;
		height: 18px;
	}
</style>
