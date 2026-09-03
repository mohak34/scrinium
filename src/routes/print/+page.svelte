<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { loadNote } from '$lib/stores/vault';
	import { renderNoteToHtml } from '$lib/print/renderNote';
	import 'katex/dist/katex.min.css';

	const notePath = $derived($page.url.searchParams.get('note') ?? '');
	const title = $derived(notePath.split('/').pop() ?? 'note');
	let html = $state('');
	let error = $state('');

	onMount(() => {
		if (!notePath) {
			goto('/');
			return;
		}
		loadNote(notePath)
			.then((content) => {
				html = renderNoteToHtml(content);
			})
			.catch(() => {
				error = 'Could not load note';
			});
	});
</script>

<svelte:head>
	<title>{title} — Scrinium print</title>
</svelte:head>

<div class="print-screen">
	<div class="print-toolbar no-print">
		<button type="button" onclick={() => history.back()}>← Back</button>
		<span class="print-path">{notePath}</span>
		<button type="button" class="print-btn" onclick={() => window.print()}>
			Print / Save as PDF
		</button>
	</div>
	{#if error}
		<p class="print-error">{error}</p>
	{:else}
		<article class="paper">{@html html}</article>
	{/if}
</div>

<style>
	.print-screen {
		height: 100vh;
		overflow-y: auto;
		background: var(--surface-container-low);
		color: #111;
	}
	.print-toolbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		background: var(--surface-container);
		border-bottom: 1px solid var(--border-default);
		color: var(--on-surface);
	}
	.print-path {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-ui-small);
		color: var(--outline);
	}
	.print-toolbar button {
		background: var(--surface-container-high);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface);
		font-size: var(--font-ui-small);
		padding: 6px 12px;
		cursor: pointer;
	}
	.print-btn {
		background: var(--primary-container) !important;
		border-color: transparent !important;
		color: var(--on-primary-container) !important;
		font-weight: 600;
	}
	.print-error {
		padding: 2rem;
		text-align: center;
	}
	.paper {
		background: #fff;
		color: #161616;
		max-width: 720px;
		margin: 24px auto 48px;
		padding: 48px 56px;
		border-radius: 4px;
		font-size: 15px;
		line-height: 1.65;
	}
	.paper :global(h1),
	.paper :global(h2),
	.paper :global(h3),
	.paper :global(h4) {
		line-height: 1.3;
		margin: 1.4em 0 0.5em;
	}
	.paper :global(h1) {
		font-size: 1.7em;
	}
	.paper :global(h2) {
		font-size: 1.4em;
	}
	.paper :global(h3) {
		font-size: 1.2em;
	}
	.paper :global(a) {
		color: #1a53d6;
	}
	.paper :global(code.print-inline-code) {
		font-family: var(--font-mono);
		background: #f0f0f0;
		padding: 0.1em 0.35em;
		border-radius: 4px;
		font-size: 0.9em;
	}
	.paper :global(pre.print-code) {
		background: #f5f5f5;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 0.75rem 1rem;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 0.88em;
		break-inside: avoid;
	}
	.paper :global(.print-code-lang) {
		color: #666;
		font-size: 0.75em;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.4rem;
	}
	.paper :global(.print-math) {
		text-align: center;
		margin: 0.9rem 0;
		overflow-x: auto;
		break-inside: avoid;
	}
	.paper :global(.print-math) :global(.katex-display) {
		margin: 0;
	}
	.paper :global(.print-math-inline) {
		padding: 0 0.15em;
	}
	.paper :global(li) {
		margin: 0.15em 0;
	}
	.paper :global(img) {
		max-width: 100%;
	}

	@page {
		margin: 18mm 15mm;
	}
	@media print {
		:global(html),
		:global(body) {
			height: auto !important;
			overflow: visible !important;
			background: #fff !important;
		}
		.no-print {
			display: none !important;
		}
		.print-screen {
			height: auto;
			overflow: visible;
			background: #fff;
		}
		.paper {
			margin: 0;
			max-width: none;
			border-radius: 0;
			padding: 0;
		}
		.paper :global(a) {
			text-decoration: none;
			color: inherit;
		}
	}
</style>
