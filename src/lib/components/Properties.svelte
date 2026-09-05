<script lang="ts">
	import { activePath, updateFrontmatter } from '$lib/stores/vault';
	import { parseFrontmatter } from '$lib/editor/frontmatter';

	interface Props {
		content: string;
	}
	let { content }: Props = $props();

	interface Row {
		key: string;
		display: string;
		kind: 'scalar' | 'array' | 'object';
	}

	// Scalars edit as text (numbers/bools come back as strings - accepted,
	// YAML still reads them fine); scalar arrays edit comma-separated;
	// nested objects are shown read-only.
	function rowsOf(data: Record<string, unknown>): Row[] {
		return Object.entries(data).map(([key, v]) => {
			if (Array.isArray(v)) {
				const flat = v.every((i) => typeof i === 'string' || typeof i === 'number');
				return {
					key,
					display: flat ? v.map(String).join(', ') : JSON.stringify(v),
					kind: flat ? 'array' : 'object'
				};
			}
			if (v !== null && typeof v === 'object') {
				const d = v instanceof Date ? v.toISOString().slice(0, 10) : JSON.stringify(v);
				return { key, display: d, kind: v instanceof Date ? 'scalar' : 'object' };
			}
			return { key, display: v === null || v === undefined ? '' : String(v), kind: 'scalar' };
		});
	}

	const rows = $derived(rowsOf(parseFrontmatter(content)?.data ?? {}));

	let newKey = $state('');
	let newValue = $state('');
	let busy = $state(false);

	async function save(path: string, key: string, raw: string, kind: Row['kind']) {
		if (busy) return;
		busy = true;
		try {
			await updateFrontmatter(path, (doc) => {
				if (kind === 'array' || key === 'tags') {
					doc.set(key, raw.split(',').map((s) => s.trim()).filter(Boolean));
				} else {
					doc.set(key, raw);
				}
			});
		} finally {
			busy = false;
		}
	}

	async function remove(path: string, key: string) {
		if (busy) return;
		busy = true;
		try {
			await updateFrontmatter(path, (doc) => {
				doc.delete(key);
			});
		} finally {
			busy = false;
		}
	}

	async function add(path: string) {
		const key = newKey.trim();
		if (!key || busy) return;
		if (!/^[A-Za-z0-9_-]+$/.test(key)) return;
		busy = true;
		try {
			const ok = await updateFrontmatter(path, (doc) => {
				if (key === 'tags') {
					doc.set(key, newValue.split(',').map((s) => s.trim()).filter(Boolean));
				} else {
					doc.set(key, newValue);
				}
			});
			if (ok) {
				newKey = '';
				newValue = '';
			}
		} finally {
			busy = false;
		}
	}
</script>

<section aria-label="Properties">
	<header>
		<span class="title">Properties</span>
	</header>
	{#if rows.length > 0}
		<ul>
			{#each rows as r (r.key)}
				<li>
					<span class="key" title={r.key}>{r.key}</span>
					{#if r.kind === 'object'}
						<span class="readonly" title="Nested values edit as raw YAML">{r.display}</span>
					{:else}
						<input
							class="val"
							value={r.display}
							disabled={busy || !$activePath}
							onchange={(e) => {
								if ($activePath) void save($activePath, r.key, e.currentTarget.value, r.kind);
							}}
						/>
					{/if}
					<button
						class="del"
						title={`Remove ${r.key}`}
						disabled={busy || !$activePath}
						onclick={() => {
							if ($activePath) void remove($activePath, r.key);
						}}
					>
						×
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="add">
		<input
			class="key-in"
			placeholder="key"
			bind:value={newKey}
			disabled={busy || !$activePath}
			onkeydown={(e) => {
				if (e.key === 'Enter' && $activePath) void add($activePath);
			}}
		/>
		<input
			class="val-in"
			placeholder="value"
			bind:value={newValue}
			disabled={busy || !$activePath}
			onkeydown={(e) => {
				if (e.key === 'Enter' && $activePath) void add($activePath);
			}}
		/>
		<button
			class="add-btn"
			disabled={busy || !$activePath || !newKey.trim()}
			onclick={() => {
				if ($activePath) void add($activePath);
			}}
		>
			Add
		</button>
	</div>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		flex: none;
		max-height: 35%;
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
		margin: 0 0 0.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.key {
		flex: none;
		width: 64px;
		font-size: var(--font-ui-micro);
		color: var(--outline-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.val,
	.readonly {
		flex: 1;
		min-width: 0;
		font-size: var(--font-ui-small);
		color: var(--on-surface);
	}
	.val {
		font-family: var(--font-ui);
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		padding: 2px 6px;
		outline: none;
	}
	.val:focus {
		border-color: var(--primary);
	}
	.readonly {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--on-surface-variant);
	}
	.del {
		flex: none;
		background: none;
		border: none;
		color: var(--outline-variant);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 0 2px;
	}
	.del:hover:not(:disabled) {
		color: var(--primary);
	}
	.del:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.add {
		display: flex;
		gap: 4px;
	}
	.key-in,
	.val-in {
		min-width: 0;
		font-family: var(--font-ui);
		font-size: var(--font-ui-micro);
		color: var(--on-surface);
		background: transparent;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius);
		padding: 2px 6px;
		outline: none;
	}
	.key-in {
		flex: 0 1 64px;
	}
	.val-in {
		flex: 1;
	}
	.key-in:focus,
	.val-in:focus {
		border-color: var(--primary);
		border-style: solid;
	}
	.add-btn {
		flex: none;
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-micro);
		padding: 2px 8px;
		cursor: pointer;
	}
	.add-btn:hover:not(:disabled) {
		color: var(--primary);
		border-color: var(--primary);
	}
	.add-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
