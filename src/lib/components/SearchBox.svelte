<script lang="ts">
	import { onMount } from 'svelte';
	import { searchNotes, type SearchResult } from '$lib/stores/vault';
	import { focusSearchRequest, searchTagRequest } from '$lib/stores/actions';

	interface Props {
		onSelect: (path: string) => void;
	}
	let { onSelect }: Props = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let pending = $state(false);
	let open = $state(false);
	let selected = $state(0);
	let inputEl = $state<HTMLInputElement>();
	let resultsEl = $state<HTMLDivElement>();

	// The command palette's "Open search" command requests focus here.
	// The rail Tags panel requests a tag search the same way.
	onMount(() => {
		const unsubFocus = focusSearchRequest.subscribe((n) => {
			if (n) inputEl?.focus();
		});
		const unsubTag = searchTagRequest.subscribe((t) => {
			if (t) {
				// Leading `#` routes into tag search, never FTS.
				query = t.startsWith('#') ? t : `#${t}`;
				open = true;
				inputEl?.focus();
				searchTagRequest.set(null);
			}
		});
		return () => {
			unsubFocus();
			unsubTag();
		};
	});

	$effect(() => {
		const q = query.trim();
		// No debounce: this is a local SQLite query, so fire immediately on every
		// keystroke. The guard below discards out-of-order responses. The
		// "Searching…" row only appears if a request is genuinely slow (>250ms).
		// A leading `#` means tag search: exact tag census instead of FTS, so
		// plain-text occurrences never false-positive.
		results = [];
		pending = true;
		loading = false;
		if (q.length < 2) {
			pending = false;
			return;
		}
		const slowTimer = setTimeout(() => {
			loading = true;
		}, 250);
		const req =
			q.startsWith('#') && q.length > 1
				? fetch(`/api/tagged?tag=${encodeURIComponent(q.slice(1))}`).then((res) =>
						res.ok ? (res.json() as Promise<SearchResult[]>) : []
					)
				: searchNotes(q);
		void req.then((res) => {
			if (query.trim() === q) {
				results = res;
				pending = false;
				loading = false;
				clearTimeout(slowTimer);
			}
		});
		return () => clearTimeout(slowTimer);
	});

	function pick(path: string) {
		query = '';
		results = [];
		selected = 0;
		onSelect(path);
		inputEl?.blur();
	}

	function close() {
		query = '';
		results = [];
		selected = 0;
		inputEl?.blur();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowDown' && results.length) {
			e.preventDefault();
			selected = (selected + 1) % results.length;
		} else if (e.key === 'ArrowUp' && results.length) {
			e.preventDefault();
			selected = (selected - 1 + results.length) % results.length;
		} else if (e.key === 'Enter' && results.length) {
			pick(results[Math.min(selected, results.length - 1)]?.path ?? results[0].path);
		}
	}

	// New results reset the cursor; moving it keeps the row in view.
	$effect(() => {
		query;
		selected = 0;
	});
	$effect(() => {
		selected;
		resultsEl?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
	});
</script>

<div class="searchbox">
	<div class="search-field">
		<span class="material-symbols-outlined search-icon">search</span>
		<input
			bind:this={inputEl}
			class="search-input"
			placeholder="Search notes"
			bind:value={query}
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 150)}
			onkeydown={onKeyDown}
		/>
		{#if !query}<span class="kbd">/</span>{/if}
	</div>
	{#if open && query.trim()}
		<div class="results" bind:this={resultsEl}>
			{#if loading}
				<div class="row muted">Searching…</div>
			{:else if results.length === 0}
				{#if !pending}
					<div class="row muted">No results</div>
				{/if}
			{:else}
				{#each results as r, i (r.path)}
					<button
						class="row"
						class:selected={i === selected}
						onmousedown={() => pick(r.path)}
						onmouseenter={() => (selected = i)}
					>
						<span class="title">{r.title || r.path}</span>
						<span class="path">{r.path}</span>
						{#if r.snippet}
							<span class="snippet">{r.snippet}</span>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.searchbox {
		position: relative;
		padding: 2px 10px 8px;
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-md);
		padding: 0 8px 0 10px;
	}
	.search-field:focus-within {
		border-color: var(--accent);
	}
	.search-icon {
		color: var(--text-3);
		font-size: 18px;
	}
	.search-input {
		flex: 1;
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text);
		font: var(--fs) var(--font-ui);
		padding: 0;
	}
	.search-input::placeholder {
		color: var(--text-3);
	}
	.results {
		position: absolute;
		top: calc(100% - 4px);
		left: 10px;
		right: 10px;
		z-index: 60;
		background: var(--panel);
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow);
		max-height: 55vh;
		overflow-y: auto;
		padding: 4px;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: var(--text-2);
		padding: 7px 9px;
		border-radius: var(--r);
		cursor: pointer;
	}
	.row:hover,
	.row.selected {
		background: var(--hover);
	}
	.row.muted {
		cursor: default;
		color: var(--text-3);
	}
	.title {
		font-size: var(--fs);
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.path {
		font-size: var(--fs-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.snippet {
		font: var(--fs-sm) / 1.5 var(--font-read);
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
