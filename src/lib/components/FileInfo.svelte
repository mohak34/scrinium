<script lang="ts">
	import { parseFrontmatter, stripFrontmatter, propDisplayRows } from '$lib/editor/frontmatter';
	import { activePath, updateFrontmatter } from '$lib/stores/vault';

	interface Props {
		content: string;
	}
	let { content }: Props = $props();

	type AddKind = 'text' | 'status' | 'priority' | 'tags' | 'date';
	const ADD_TYPES: Array<{ id: AddKind; icon: string; label: string; hint: string }> = [
		{ id: 'text', icon: 'text_fields', label: 'Text', hint: 'Any key and value' },
		{ id: 'status', icon: 'flag', label: 'Status', hint: 'Not started, In progress, Done' },
		{ id: 'priority', icon: 'priority_high', label: 'Priority', hint: 'Low, Medium, High' },
		{ id: 'tags', icon: 'tag', label: 'Tags', hint: 'Comma-separated' },
		{ id: 'date', icon: 'calendar_month', label: 'Date', hint: 'Picks a calendar date' }
	];

	let adding = $state<AddKind | null>(null);
	let fieldKey = $state('');
	let fieldValue = $state('');
	let saving = $state(false);

	async function saveAdd() {
		const path = $activePath;
		if (!path || saving || !adding) return;
		const kind = adding;
		const key = kind === 'text' ? fieldKey.trim() : kind === 'date' ? 'date' : kind;
		const value = fieldValue.trim();
		if (kind === 'text' && !/^[A-Za-z0-9_-]+$/.test(key)) return;
		if (!value) return;
		saving = true;
		try {
			const ok = await updateFrontmatter(path, (doc) => {
				if (kind === 'tags') {
					const prev = Array.isArray(doc.get(key))
						? (doc.get(key) as unknown[]).map(String)
						: [];
					const next = value
						.split(',')
						.map((s) => s.trim().replace(/^#+/, ''))
						.filter(Boolean);
					doc.set(key, [...new Set([...prev, ...next])]);
				} else {
					doc.set(key, value);
				}
			});
			if (ok) {
				adding = null;
				fieldKey = '';
				fieldValue = '';
			}
		} finally {
			saving = false;
		}
	}

	function pick(kind: AddKind) {
		adding = kind;
		fieldKey = '';
		fieldValue = kind === 'date' ? new Date().toISOString().slice(0, 10) : '';
	}

	// Estimates over the body (frontmatter excluded): fenced code dropped,
	// words are alphanumeric runs. Good enough for a rail readout.
	const words = $derived.by(() => {
		const body = stripFrontmatter(content).replace(/```[\s\S]*?(```|$)/g, ' ');
		return body.match(/[A-Za-z0-9']+/g)?.length ?? 0;
	});

	const fm = $derived(parseFrontmatter(content)?.data ?? null);
	const status = $derived(fm && typeof fm['status'] === 'string' && fm['status'].trim() ? fm['status'].trim() : null);
	const priority = $derived(
		fm && typeof fm['priority'] === 'string' && fm['priority'].trim() ? fm['priority'].trim() : null
	);
	// Every other key as a quiet read-only row; editing lives in the in-doc
	// box, so this card grows no save path. `tags` lives in the Tags
	// section (with click-to-search), not duplicated here.
	const extra = $derived.by(() => {
		if (!fm) return [];
		return propDisplayRows(fm).filter(
			(r) => r.key !== 'status' && r.key !== 'priority' && r.key !== 'tags'
		);
	});

	function pill(value: string): string {
		const v = value.toLowerCase();
		if (['done', 'complete', 'completed', 'low'].includes(v)) return 'ok';
		if (['in progress', 'doing', 'medium'].includes(v)) return 'warn';
		if (['high', 'urgent', 'blocked'].includes(v)) return 'bad';
		return '';
	}
</script>

<section aria-label="Properties">
	<header>
		<span class="title">Properties</span>
		<button
			class="add-toggle"
			title="Add property"
			disabled={!$activePath}
			onclick={() => (adding = adding ? null : 'text')}
		>
			<span class="material-symbols-outlined">add</span>
		</button>
	</header>
	{#if adding}
		<div class="addbox">
			<div class="types">
				{#each ADD_TYPES as t (t.id)}
					<button
						class="type {adding === t.id ? 'on' : ''}"
						title={t.hint}
						onclick={() => pick(t.id)}
					>
						<span class="material-symbols-outlined">{t.icon}</span>
						{t.label}
					</button>
				{/each}
			</div>
			{#if adding === 'text'}
				<div class="form">
					<input
						class="in key"
						placeholder="key"
						bind:value={fieldKey}
						disabled={saving}
						onkeydown={(e) => {
							if (e.key === 'Enter') void saveAdd();
							if (e.key === 'Escape') adding = null;
						}}
					/>
					<input
						class="in"
						placeholder="value"
						bind:value={fieldValue}
						disabled={saving}
						onkeydown={(e) => {
							if (e.key === 'Enter') void saveAdd();
							if (e.key === 'Escape') adding = null;
						}}
					/>
				</div>
			{:else if adding === 'date'}
				<div class="form">
					<input
						class="in"
						type="date"
						bind:value={fieldValue}
						disabled={saving}
						onkeydown={(e) => {
							if (e.key === 'Enter') void saveAdd();
							if (e.key === 'Escape') adding = null;
						}}
					/>
				</div>
			{:else}
				<div class="form">
					<input
						class="in"
						placeholder={adding === 'tags' ? 'ml, course/neural' : `New ${adding}…`}
						bind:value={fieldValue}
						disabled={saving}
						list={adding === 'status' || adding === 'priority' ? `props-${adding}` : undefined}
						onkeydown={(e) => {
							if (e.key === 'Enter') void saveAdd();
							if (e.key === 'Escape') adding = null;
						}}
					/>
				</div>
				{#if adding === 'status'}
					<datalist id="props-status">
						<option value="Not started"></option>
						<option value="In progress"></option>
						<option value="Done"></option>
					</datalist>
				{:else if adding === 'priority'}
					<datalist id="props-priority">
						<option value="Low"></option>
						<option value="Medium"></option>
						<option value="High"></option>
					</datalist>
				{/if}
			{/if}
			<div class="form-actions">
				<button class="link-btn" disabled={saving} onclick={() => (adding = null)}>Cancel</button>
				<button
					class="link-btn primary"
					disabled={saving || !fieldValue.trim() || (adding === 'text' && !fieldKey.trim())}
					onclick={() => void saveAdd()}
				>
					{saving ? 'Adding…' : 'Add'}
				</button>
			</div>
		</div>
	{/if}
	<div class="card">
		{#if status}
			<div class="row">
				<span class="label">
					<span class="material-symbols-outlined">flag</span> Status
				</span>
				<span class="pill {pill(status)}">{status}</span>
			</div>
		{/if}
		{#if priority}
			<div class="row">
				<span class="label">
					<span class="material-symbols-outlined">priority_high</span> Priority
				</span>
				<span class="pill {pill(priority)}">{priority}</span>
			</div>
		{/if}
		<div class="row">
			<span class="label">
				<span class="material-symbols-outlined">format_align_left</span> Words
			</span>
			<span class="val">{words.toLocaleString()}</span>
		</div>
		{#each extra as r (r.key)}
			<div class="row">
				<span class="label" title={r.key}>{r.key}</span>
				<span class="val" title={r.display}>{r.display}</span>
			</div>
		{/each}
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
	.card {
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: var(--font-ui-small);
	}
	.label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--on-surface-variant);
	}
	.label .material-symbols-outlined {
		font-size: 14px;
	}
	.val {
		color: var(--on-surface);
		font-variant-numeric: tabular-nums;
		max-width: 62%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: right;
	}
	.add-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface-variant);
		cursor: pointer;
	}
	.add-toggle:hover:not(:disabled) {
		background: var(--surface-container-low);
		color: var(--primary);
	}
	.add-toggle:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.add-toggle .material-symbols-outlined {
		font-size: 16px;
	}
	.addbox {
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 8px;
		margin-bottom: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.type {
		display: flex;
		align-items: center;
		gap: 4px;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 999px;
		color: var(--on-surface-variant);
		font-size: var(--font-ui-micro);
		padding: 2px 8px 2px 6px;
		cursor: pointer;
	}
	.type .material-symbols-outlined {
		font-size: 13px;
	}
	.type:hover {
		border-color: var(--primary);
		color: var(--primary);
	}
	.type.on {
		border-color: var(--primary);
		color: var(--primary);
		background: rgba(181, 196, 255, 0.08);
	}
	.form {
		display: flex;
		gap: 4px;
	}
	.in {
		flex: 1;
		min-width: 0;
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		color: var(--on-surface);
		background: var(--surface-container);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		padding: 3px 6px;
		outline: none;
	}
	.in.key {
		flex: 0 1 70px;
	}
	.in:focus {
		border-color: var(--primary);
	}
	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 4px;
	}
	.link-btn {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-micro);
		padding: 2px 10px;
		cursor: pointer;
	}
	.link-btn:hover:not(:disabled) {
		color: var(--primary);
		border-color: var(--primary);
	}
	.link-btn.primary {
		color: var(--primary);
		border-color: var(--primary);
	}
	.link-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.pill {
		font-size: var(--font-ui-micro);
		color: var(--on-surface-variant);
		background: var(--surface-container-high);
		border: 1px solid var(--border-default);
		border-radius: 999px;
		padding: 0 8px;
		max-width: 55%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pill.ok {
		color: #7dd8a8;
		border-color: rgba(125, 216, 168, 0.3);
		background: rgba(125, 216, 168, 0.08);
	}
	.pill.warn {
		color: #f0c674;
		border-color: rgba(240, 198, 116, 0.3);
		background: rgba(240, 198, 116, 0.08);
	}
	.pill.bad {
		color: #f19494;
		border-color: rgba(241, 148, 148, 0.3);
		background: rgba(241, 148, 148, 0.08);
	}
</style>
