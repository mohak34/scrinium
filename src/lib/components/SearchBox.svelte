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
	let pending = $state(false);
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
		// No debounce: this is a local SQLite query, so fire immediately on every
		// keystroke. The guard below discards out-of-order responses. The
		// "Searching…" row only appears if a request is genuinely slow (>250ms).
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
		void searchNotes(q).then((res) => {
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
	<div class="search-field">
		<span class="material-symbols-outlined search-icon">search</span>
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
	</div>
	{#if open && query.trim()}
		<div class="results">
			{#if loading}
				<div class="row muted">Searching…</div>
			{:else if results.length === 0}
				{#if !pending}
					<div class="row muted">No results</div>
				{/if}
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
		padding: 0 var(--panel-padding) var(--gutter);
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		padding: 3px 8px;
	}
	.search-field:focus-within {
		border-color: var(--primary);
	}
	.search-icon {
		color: var(--on-surface-variant);
		font-size: 14px;
	}
	.search-input {
		flex: 1;
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: var(--on-surface);
		font-family: var(--font-ui);
		font-size: var(--font-ui-micro);
		line-height: var(--font-ui-micro-lh);
		padding: 0;
	}
	.search-input::placeholder {
		color: var(--on-surface-variant);
	}
	.results {
		position: absolute;
		top: calc(100% - 12px);
		left: var(--panel-padding);
		right: var(--panel-padding);
		z-index: 60;
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-pop);
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
		color: var(--on-surface-variant);
		padding: 6px 8px;
		border-radius: var(--radius);
		cursor: pointer;
	}
	.row:hover {
		background: var(--surface-container-high);
	}
	.row.muted {
		cursor: default;
		color: var(--outline);
	}
	.title {
		font-size: var(--font-ui-small);
		color: var(--on-surface);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.path {
		font-size: var(--font-ui-micro);
		color: var(--outline);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.snippet {
		font-size: var(--font-ui-micro);
		color: var(--on-surface-variant);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
