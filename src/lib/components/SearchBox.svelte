<script lang="ts">
	import { onMount } from 'svelte';
	import { searchNotes, type SearchResult } from '$lib/stores/vault';
	import { focusSearchRequest } from '$lib/stores/actions';

	interface Props {
		onSelect: (path: string) => void;
	}
	let { onSelect }: Props = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let open = $state(false);
	let inputEl = $state<HTMLInputElement>();

	// The command palette's "Open search" command requests focus here.
	onMount(() => {
		const unsub = focusSearchRequest.subscribe((n) => {
			if (n) inputEl?.focus();
		});
		return unsub;
	});

	$effect(() => {
		const q = query.trim();
		// Clear previous results immediately so a slow debounce never flashes
		// the old query's matches.
		results = [];
		if (q.length < 2) {
			loading = false;
			return;
		}
		loading = true;
		const timer = setTimeout(async () => {
			const res = await searchNotes(q);
			if (query.trim() === q) {
				results = res;
				loading = false;
			}
		}, 150);
		return () => clearTimeout(timer);
	});

	function pick(path: string) {
		query = '';
		results = [];
		onSelect(path);
		inputEl?.blur();
	}

	function close() {
		query = '';
		results = [];
		inputEl?.blur();
	}
</script>

<div class="searchbox">
	<input
		bind:this={inputEl}
		class="search-input"
		placeholder="Search notes…"
		bind:value={query}
		onfocus={() => (open = true)}
		onblur={() => setTimeout(() => (open = false), 150)}
		onkeydown={(e) => {
			if (e.key === 'Escape') close();
			if (e.key === 'Enter' && results.length) pick(results[0].path);
		}}
	/>
	{#if open && query.trim()}
		<div class="results">
			{#if loading}
				<div class="row muted">Searching…</div>
			{:else if results.length === 0}
				<div class="row muted">No results</div>
			{:else}
				{#each results as r (r.path)}
					<button class="row" onmousedown={() => pick(r.path)}>
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
		padding: 0 0.5rem 0.5rem;
	}
	.search-input {
		width: 100%;
		background: #24262f;
		border: 1px solid #2a2d38;
		border-radius: 6px;
		color: #e6e6e6;
		padding: 0.4rem 0.6rem;
		font-size: 0.82rem;
		outline: none;
	}
	.search-input:focus {
		border-color: #4f7cff;
	}
	.results {
		position: absolute;
		top: calc(100% - 0.25rem);
		left: 0.5rem;
		right: 0.5rem;
		z-index: 60;
		background: #1c1e26;
		border: 1px solid #2a2d38;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		max-height: 55vh;
		overflow-y: auto;
		padding: 0.25rem;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: #c9cbd6;
		padding: 0.4rem 0.5rem;
		border-radius: 5px;
		cursor: pointer;
	}
	.row:hover {
		background: #2e313d;
	}
	.row.muted {
		cursor: default;
		color: #6b6e7a;
	}
	.title {
		font-size: 0.85rem;
		color: #e6e6e6;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.path {
		font-size: 0.7rem;
		color: #6b6e7a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.snippet {
		font-size: 0.75rem;
		color: #8b8e99;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
