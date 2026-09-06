<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { renderNoteToHtml } from '$lib/print/renderNote';
	import 'katex/dist/katex.min.css';

	const id = $derived($page.params.id ?? '');

	interface SharePayload {
		title: string;
		markdown: string;
		notePath: string;
		updatedAt: number | null;
		hasPassword: boolean;
		proof: string;
	}

	let status = $state<'loading' | 'locked' | 'ready' | 'error'>('loading');
	let payload = $state<SharePayload | null>(null);
	let message = $state('');
	let password = $state('');
	let busy = $state(false);

	// renderNoteToHtml points relative images at the auth-gated /api/assets.
	// Repoint them at this share's gated asset endpoint; password shares
	// attach the proof token from the unlock, never the password itself.
	function rewriteAssets(html: string, proof: string): string {
		const prefix = `/api/share/${encodeURIComponent(id)}/assets/`;
		const suffix = proof ? `?proof=${encodeURIComponent(proof)}` : '';
		return html.replaceAll('/api/assets/', `${prefix}`).replace(
			new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^"\\s<>]+)`, 'g'),
			(_, rest: string) => `${prefix}${rest}${suffix}`
		);
	}

	// "just now", "3h ago", "2d ago" - absolute date past a week.
	function timeAgo(mtimeMs: number): string {
		const secs = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
		if (secs < 60) return 'just now';
		const mins = Math.floor(secs / 60);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(mtimeMs).toLocaleDateString();
	}

	const html = $derived.by(() => {
		if (!payload) return '';
		try {
			return rewriteAssets(renderNoteToHtml(payload.markdown, payload.notePath), payload.proof);
		} catch {
			return '';
		}
	});

	async function load() {
		const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
		if (res.status === 401) {
			status = 'locked';
			return;
		}
		if (res.status === 410) {
			status = 'error';
			message = 'This note no longer exists.';
			return;
		}
		if (!res.ok) {
			status = 'error';
			message = 'This link is invalid or was revoked.';
			return;
		}
		payload = (await res.json()) as SharePayload;
		status = 'ready';
	}

	async function unlock() {
		if (!password || busy) return;
		busy = true;
		try {
			const res = await fetch(`/api/share/${encodeURIComponent(id)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (res.status === 401) {
				message = 'Wrong password. Try again.';
				return;
			}
			if (!res.ok) {
				message = 'This link is invalid or was revoked.';
				status = 'error';
				return;
			}
			message = '';
			password = '';
			payload = (await res.json()) as SharePayload;
			status = 'ready';
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		if (!id) {
			status = 'error';
			message = 'This link is invalid or was revoked.';
			return;
		}
		void load();
	});
</script>

<svelte:head>
	<title>{payload ? `${payload.title} — shared note` : 'Shared note'}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="shared">
	{#if status === 'loading'}
		<p class="state">Loading shared note…</p>
	{:else if status === 'locked'}
		<form
			class="lock"
			onsubmit={(e) => {
				e.preventDefault();
				void unlock();
			}}
		>
			<span class="material-symbols-outlined">lock</span>
			<h1>This note is password protected</h1>
			<p>Enter the password to view it.</p>
			<input
				type="password"
				placeholder="Password"
				autocomplete="current-password"
				bind:value={password}
				disabled={busy}
			/>
			{#if message}<p class="err">{message}</p>{/if}
			<button type="submit" disabled={!password || busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
		</form>
	{:else if status === 'error'}
		<div class="lock">
			<span class="material-symbols-outlined">link_off</span>
			<h1>Link unavailable</h1>
			<p>{message}</p>
		</div>
	{:else if payload}
		<header class="bar">
			<span class="doc">{payload.notePath}</span>
			<span class="via" title={payload.updatedAt ? new Date(payload.updatedAt).toLocaleString() : undefined}>
				shared read-only{#if payload.updatedAt} · updated {timeAgo(payload.updatedAt)}{/if}
			</span>
		</header>
		<article class="paper">{@html html}</article>
	{/if}
</div>

<style>
	.shared {
		/* Definite height (not min-height): the app shell pins body to
		overflow hidden, so only a fixed-height box here can scroll. */
		height: 100vh;
		overflow-y: auto;
		background: #000;
		color: #eee;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.state {
		margin-top: 20vh;
		color: #888;
	}
	.lock {
		margin: 16vh auto 0;
		width: min(360px, calc(100vw - 3rem));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		text-align: center;
		background: #0d0d0d;
		border: 1px solid #262626;
		border-radius: 12px;
		padding: 2rem 1.5rem;
	}
	.lock .material-symbols-outlined {
		font-size: 28px;
		color: #888;
	}
	.lock h1 {
		font-size: 1.05rem;
		margin: 0;
	}
	.lock p {
		margin: 0;
		color: #888;
		font-size: 0.85rem;
	}
	.lock input {
		width: 100%;
		background: #000;
		border: 1px solid #333;
		border-radius: 8px;
		color: #eee;
		padding: 0.55rem 0.75rem;
		font-size: 0.9rem;
		outline: none;
	}
	.lock input:focus {
		border-color: #666;
	}
	.lock button {
		width: 100%;
		border: none;
		border-radius: 8px;
		background: #eee;
		color: #000;
		font-weight: 600;
		padding: 0.55rem;
		cursor: pointer;
	}
	.lock button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.err {
		color: #f19494 !important;
	}
	.bar {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border-bottom: 1px solid #222;
		font-size: 0.8rem;
	}
	.doc {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #bbb;
	}
	.via {
		color: #666;
	}
	.paper {
		background: #fff;
		color: #161616;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		width: min(720px, calc(100vw - 2rem));
		margin: 24px auto 48px;
		padding: 48px 56px;
		border-radius: 4px;
		font-size: 15px;
		line-height: 1.65;
	}
	@media (max-width: 640px) {
		.paper {
			padding: 28px 22px;
		}
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
	.paper :global(.print-wikilink),
	.paper :global(.print-tag) {
		color: #1a53d6;
		background: rgba(26, 83, 214, 0.08);
		padding: 0.05em 0.35em;
		border-radius: 4px;
	}
	.paper :global(blockquote) {
		background: #f5f5f5;
		border: 1px solid #ddd;
		border-left: 3px solid #1a53d6;
		border-radius: 0 6px 6px 0;
		padding: 0.6rem 1rem;
		margin: 1em 0;
	}
	.paper :global(pre.print-code) {
		background: #f5f5f5;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 0.75rem 1rem;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 0.88em;
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
		/* KaTeX struts overhang the line box by a few px, and overflow-x:
		auto computes overflow-y to auto too - every block grew a phantom
		vertical scrollbar. Hidden kills it; the padding keeps real
		descender ink visible instead of clipped. */
		overflow-y: hidden;
		padding: 0.25em 0;
	}
	.paper :global(.print-math) :global(.katex-display) {
		margin: 0;
	}
	.paper :global(li) {
		margin: 0.15em 0;
	}
	.paper :global(img) {
		max-width: 100%;
	}
	.paper :global(.callout) {
		border-left: 4px solid var(--callout-accent, #448aff);
		background: var(--callout-bg, rgba(68, 138, 255, 0.1));
		border-radius: 6px;
		padding: 0.6rem 0.9rem;
		margin: 0.9rem 0;
	}
	.paper :global(.callout-title) {
		display: flex;
		align-items: center;
		gap: 0.4em;
		font-weight: 700;
		color: var(--callout-accent, #1a53d6);
		margin-bottom: 0.3rem;
	}
	.paper :global(.callout-icon) {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}
	.paper :global(.callout-body > :first-child) {
		margin-top: 0;
	}
	.paper :global(.callout-body > :last-child) {
		margin-bottom: 0;
	}
</style>
