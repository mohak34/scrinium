<script lang="ts">
	import { page } from '$app/state';
	import type { SharePage } from '$lib/server/shares';
	import 'katex/dist/katex.min.css';

	let { data } = $props();
	const id = $derived(page.params.id ?? '');

	// Open links arrive rendered from the server; a locked one fills in here
	// after the unlock.
	let unlocked = $state<SharePage | null>(null);
	const share = $derived(unlocked ?? data.share);
	let failed = $state('');
	const status = $derived(failed ? 'error' : share ? 'ready' : data.state);
	const errorMessage = $derived(failed || data.message || 'This link is invalid or was revoked.');
	let message = $state('');
	let password = $state('');
	let busy = $state(false);

	// A link to another share reuses this page: drop the last one's unlock.
	$effect.pre(() => {
		void id;
		unlocked = null;
		failed = message = password = '';
	});

	// Reader zoom on the paper. Scales the base font size (everything inside
	// is sized in em, KaTeX included) so text reflows inside the viewport
	// instead of overflowing it on a phone. Print pins it back to 100%.
	const MIN_ZOOM = 50;
	const MAX_ZOOM = 200;
	const ZOOM_STEP = 10;
	let zoom = $state(100);

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

	// Contents: a side column on wide screens at normal zoom, a menu in the
	// bar otherwise. Short notes get neither.
	const toc = $derived(share && share.toc.length >= 3 ? share.toc : []);
	const top = $derived(Math.min(...toc.map((t) => t.level)));
	let current = $state('');
	let menuOpen = $state(false);

	// The section being read: the last heading scrolled past the top.
	function track() {
		let id = toc[0]?.id ?? '';
		for (const t of toc) {
			const el = document.getElementById(t.id);
			if (el && el.getBoundingClientRect().top > 96) break;
			id = t.id;
		}
		current = id;
	}

	$effect(() => {
		if (toc.length) track();
	});

	async function unlock() {
		if (!password || busy) return;
		busy = true;
		const asked = id;
		try {
			const res = await fetch(`/api/share/${encodeURIComponent(asked)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (asked !== id) return;
			if (res.status === 401) {
				message = 'Wrong password. Try again.';
				return;
			}
			if (res.status === 429) {
				message = 'Too many wrong passwords. Try again in a few minutes.';
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				failed = body?.message || 'This link is invalid or was revoked.';
				return;
			}
			message = '';
			password = '';
			unlocked = (await res.json()) as SharePage;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window
	onscroll={() => toc.length && track()}
	onclick={(e) => menuOpen && !(e.target as Element).closest('.contents') && (menuOpen = false)}
	onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)}
/>

{#snippet contents(cls: string)}
	<nav class={cls} aria-label="Contents">
		{#each toc as t (t.id)}
			<a
				href="#{t.id}"
				class:on={t.id === current}
				style:padding-left="{(t.level - top) * 14 + 12}px"
				onclick={() => (menuOpen = false)}>{t.text}</a
			>
		{/each}
	</nav>
{/snippet}

<svelte:head>
	<title>{share?.title ?? 'Shared note'}</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta property="og:type" content="article" />
	<meta property="og:title" content={share?.title ?? 'Shared note'} />
	{#if share?.description}
		<meta name="description" content={share.description} />
		<meta property="og:description" content={share.description} />
	{/if}
</svelte:head>

<div class="shared">
	{#if status === 'locked'}
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
			<p>{errorMessage}</p>
		</div>
	{:else if share}
		<header class="bar">
			<span class="doc">{share.title}</span>
			<span class="tag">read-only</span>
			<span class="tools">
				{#if toc.length}
					<span class="contents">
						<button
							class="tbtn wide"
							class:always={zoom > 100}
							class:open={menuOpen}
							title="Contents"
							aria-expanded={menuOpen}
							onclick={() => (menuOpen = !menuOpen)}
						>
							<span class="material-symbols-outlined">toc</span><span class="lbl">Contents</span>
						</button>
						{#if menuOpen}{@render contents('toc menu')}{/if}
					</span>
					<span class="zoom-sep"></span>
				{/if}
				<button
					class="tbtn"
					title="Download / print PDF"
					onclick={() => window.print()}
				>
					<span class="material-symbols-outlined">picture_as_pdf</span>
				</button>
				<span class="zoom-sep"></span>
				<button
					class="tbtn"
					title="Zoom out"
					disabled={zoom <= MIN_ZOOM}
					onclick={() => (zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP))}
				>
					<span class="material-symbols-outlined">remove</span>
				</button>
				<button class="pct" title="Reset zoom" onclick={() => (zoom = 100)}>
					{zoom}%
				</button>
				<button
					class="tbtn"
					title="Zoom in"
					disabled={zoom >= MAX_ZOOM}
					onclick={() => (zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP))}
				>
					<span class="material-symbols-outlined">add</span>
				</button>
			</span>
			{#if share.updatedAt}
				<span class="time" title={new Date(share.updatedAt).toLocaleString()}>
					updated {timeAgo(share.updatedAt)}
				</span>
			{/if}
		</header>
		{#if toc.length && zoom <= 100}{@render contents('toc rail')}{/if}
		<article class="paper" style:--zoom={zoom / 100}>{@html share.html}</article>
	{/if}
</div>

<style>
	/* The page scrolls the document itself (the root layout skips its
	overflow pin on /s/), so phones get native scrolling, pinch zoom and a
	collapsing URL bar. */
	.shared {
		min-height: 100dvh;
		background: #000;
		color: #eee;
		-webkit-text-size-adjust: 100%;
		text-size-adjust: 100%;
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
		position: sticky;
		top: 0;
		z-index: 20;
		background: #000;
		width: 100%;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 16px;
		border-bottom: 1px solid #222;
		font-size: 0.8rem;
	}
	.doc {
		flex: 1 1 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #fff;
		font-weight: 600;
	}
	.tag {
		color: #888;
		border: 1px solid #333;
		border-radius: 999px;
		padding: 0 8px;
		white-space: nowrap;
	}
	.time {
		color: #888;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tools {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.tbtn {
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: #888;
		border-radius: 6px;
		cursor: pointer;
		padding: 0;
	}
	.tbtn .material-symbols-outlined {
		font-size: 17px;
	}
	.tbtn:hover:not(:disabled) {
		background: #1a1a1a;
		color: #eee;
	}
	.tbtn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.pct {
		min-width: 48px;
		background: none;
		border: none;
		color: #888;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
		cursor: pointer;
		padding: 4px 2px;
		border-radius: 6px;
	}
	.pct:hover {
		background: #1a1a1a;
		color: #eee;
	}
	@media (pointer: coarse) {
		.tbtn {
			width: 36px;
			height: 36px;
		}
		.pct {
			min-height: 36px;
		}
	}
	.tbtn.wide {
		display: none;
		width: auto;
		gap: 6px;
		padding: 0 8px;
	}
	.tbtn.wide.always,
	.tbtn.open {
		display: flex;
	}
	.tbtn.open {
		background: #1a1a1a;
		color: #eee;
	}
	.contents {
		position: relative;
		display: flex;
	}
	.toc a {
		display: block;
		padding-top: 5px;
		padding-bottom: 5px;
		padding-right: 12px;
		color: #888;
		text-decoration: none;
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.toc a:hover {
		color: #fff;
	}
	.toc a.on {
		color: #5db8aa;
	}
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 10;
		width: min(300px, calc(100vw - 2rem));
		max-height: 70vh;
		overflow-y: auto;
		padding: 6px 0;
		background: #000;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		font-size: 0.85rem;
	}
	.menu a:hover {
		background: #111;
	}
	/* Fixed left of the 880px sheet, shown only when there is room for it. */
	.rail {
		position: fixed;
		top: 72px;
		left: calc(50% - 440px - 252px);
		width: 220px;
		max-height: calc(100vh - 96px);
		overflow-y: auto;
		border-left: 1px solid #222;
		font-size: 0.8rem;
	}
	.rail a.on {
		box-shadow: inset 1px 0 #5db8aa;
	}
	@media (max-width: 1399px) {
		.rail {
			display: none;
		}
		.tbtn.wide {
			display: flex;
		}
	}
	@media (max-width: 640px) {
		.tbtn.wide .lbl {
			display: none;
		}
		.tbtn.wide {
			padding: 0 6px;
		}
	}
	.paper :global(:is(h1, h2, h3, h4, h5, h6)[id]) {
		scroll-margin-top: 80px;
	}
	.zoom-sep {
		width: 1px;
		height: 16px;
		background: #333;
		margin: 0 4px;
	}
	.paper {
		background: #fff;
		color: #161616;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		width: min(calc(880px * var(--zoom, 1)), calc(100% - 2rem));
		margin: 24px auto 48px;
		padding: 3.2em 3.75em;
		border-radius: 4px;
		font-size: calc(17px * var(--zoom, 1));
		line-height: 1.65;
		overflow-wrap: break-word;
	}
	/* Phones: edge-to-edge sheet, fixed gutters so zoom spends width on text. */
	@media (max-width: 640px) {
		.paper {
			width: 100%;
			margin: 0;
			padding: 24px 18px 48px;
			border-radius: 0;
			font-size: calc(15px * var(--zoom, 1));
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

	/* PDF via the browser dialog: drop the dark shell and header, pin zoom
	so the output is always full-size regardless of the reader's setting. */
	@media print {
		:global(html),
		:global(body) {
			height: auto !important;
			background: #fff !important;
		}
		.shared {
			min-height: 0;
			background: #fff;
		}
		.bar,
		.rail {
			display: none;
		}
		.paper {
			margin: 0;
			width: auto;
			max-width: none;
			padding: 48px 56px;
			border-radius: 0;
			font-size: 15px;
		}
		.paper :global(a) {
			text-decoration: none;
			color: inherit;
		}
	}
</style>
