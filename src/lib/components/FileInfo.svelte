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
	let menuOpen = $state(false);
	let menuIndex = $state(0);
	let fieldKey = $state('');
	let fieldValue = $state('');
	let saving = $state(false);
	let editing = $state<string | null>(null);
	let editValue = $state('');
	let menuEl = $state<HTMLDivElement>();

	function takeFocus(el: HTMLInputElement) {
		el.focus();
	}

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
		menuOpen = false;
		menuIndex = ADD_TYPES.findIndex((t) => t.id === kind);
		fieldKey = '';
		fieldValue = kind === 'date' ? new Date().toISOString().slice(0, 10) : '';
	}

	function toggleMenu() {
		if (menuOpen || adding) {
			menuOpen = false;
			adding = null;
		} else {
			menuOpen = true;
			menuIndex = 0;
		}
	}

	function menuKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			menuIndex = (menuIndex + 1) % ADD_TYPES.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			menuIndex = (menuIndex - 1 + ADD_TYPES.length) % ADD_TYPES.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			pick(ADD_TYPES[menuIndex].id);
		} else if (e.key === 'Escape') {
			menuOpen = false;
		}
	}

	$effect(() => {
		if (menuOpen) menuEl?.focus();
	});

	function displayOf(key: string): string | null {
		if (key === 'status') return status;
		if (key === 'priority') return priority;
		return extra.find((r) => r.key === key)?.display ?? null;
	}

	function startEdit(key: string) {
		if (saving || !$activePath) return;
		const d = displayOf(key);
		if (d === null) return;
		editing = key;
		editValue = d;
	}

	async function commitEdit(key: string) {
		if (editing !== key) return;
		editing = null;
		const path = $activePath;
		if (!path || saving) return;
		const raw = editValue.trim();
		if (!raw || raw === displayOf(key)) return;
		saving = true;
		try {
			await updateFrontmatter(path, (doc) => {
				if (Array.isArray(doc.get(key))) {
					doc.set(
						key,
						raw
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					);
				} else {
					doc.set(key, raw);
				}
			});
		} finally {
			saving = false;
		}
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
			onclick={() => toggleMenu()}
		>
			<span class="material-symbols-outlined">add</span>
		</button>
	</header>
	{#if menuOpen && !adding}
		<div class="menu" role="menu" bind:this={menuEl} tabindex="-1" onkeydown={menuKey}>
			{#each ADD_TYPES as t, i (t.id)}
				<button
					class="menu-item {i === menuIndex ? 'on' : ''}"
					role="menuitem"
					onmouseenter={() => (menuIndex = i)}
					onclick={() => pick(t.id)}
				>
					<span class="material-symbols-outlined">{t.icon}</span>
					{t.label}
				</button>
			{/each}
		</div>
	{/if}
	{#if adding}
		<div class="addform">
			{#if adding === 'text'}
				<input
					class="in key"
					placeholder="key"
					use:takeFocus
					bind:value={fieldKey}
					disabled={saving}
					onkeydown={(e) => {
						if (e.key === 'Enter') void saveAdd();
						if (e.key === 'Escape') adding = null;
					}}
				/>
			{/if}
			<input
				class="in"
				type={adding === 'date' ? 'date' : undefined}
				placeholder={adding === 'tags'
					? 'ml, course/neural'
					: adding === 'text'
						? 'value'
						: `New ${adding}…`}
				use:takeFocus
				bind:value={fieldValue}
				disabled={saving}
				list={adding === 'status' || adding === 'priority' ? `props-${adding}` : undefined}
				onkeydown={(e) => {
					if (e.key === 'Enter') void saveAdd();
					if (e.key === 'Escape') adding = null;
				}}
			/>
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
		</div>
	{/if}
	<div class="card">
		{#if status}
			<div
				class="row"
				role="button"
				tabindex="0"
				ondblclick={() => startEdit('status')}
				onkeydown={(e) => {
					if (e.key === 'Enter') startEdit('status');
				}}
				title="Double-click to edit"
			>
				<span class="label">
					<span class="material-symbols-outlined">flag</span> Status
				</span>
				{#if editing === 'status'}
					<input
						class="in"
						use:takeFocus
						bind:value={editValue}
						disabled={saving}
						list="props-status-edit"
						onfocus={(e) => e.currentTarget.select()}
						onblur={() => void commitEdit('status')}
						onkeydown={(e) => {
							if (e.key === 'Enter') void commitEdit('status');
							if (e.key === 'Escape') editing = null;
						}}
					/>
					<datalist id="props-status-edit">
						<option value="Not started"></option>
						<option value="In progress"></option>
						<option value="Done"></option>
					</datalist>
				{:else}
					<span class="pill {pill(status)}">{status}</span>
				{/if}
			</div>
		{/if}
		{#if priority}
			<div
				class="row"
				role="button"
				tabindex="0"
				ondblclick={() => startEdit('priority')}
				onkeydown={(e) => {
					if (e.key === 'Enter') startEdit('priority');
				}}
				title="Double-click to edit"
			>
				<span class="label">
					<span class="material-symbols-outlined">priority_high</span> Priority
				</span>
				{#if editing === 'priority'}
					<input
						class="in"
						use:takeFocus
						bind:value={editValue}
						disabled={saving}
						list="props-priority-edit"
						onfocus={(e) => e.currentTarget.select()}
						onblur={() => void commitEdit('priority')}
						onkeydown={(e) => {
							if (e.key === 'Enter') void commitEdit('priority');
							if (e.key === 'Escape') editing = null;
						}}
					/>
					<datalist id="props-priority-edit">
						<option value="Low"></option>
						<option value="Medium"></option>
						<option value="High"></option>
					</datalist>
				{:else}
					<span class="pill {pill(priority)}">{priority}</span>
				{/if}
			</div>
		{/if}
		<div class="row">
			<span class="label">
				<span class="material-symbols-outlined">format_align_left</span> Words
			</span>
			<span class="val">{words.toLocaleString()}</span>
		</div>
		{#each extra as r (r.key)}
			<div
				class="row"
				role="button"
				tabindex="0"
				ondblclick={() => startEdit(r.key)}
				onkeydown={(e) => {
					if (e.key === 'Enter') startEdit(r.key);
				}}
				title="Double-click to edit"
			>
				<span class="label" title={r.key}>{r.key}</span>
				{#if editing === r.key}
					<input
						class="in"
						use:takeFocus
						bind:value={editValue}
						disabled={saving}
						onfocus={(e) => e.currentTarget.select()}
						onblur={() => void commitEdit(r.key)}
						onkeydown={(e) => {
							if (e.key === 'Enter') void commitEdit(r.key);
							if (e.key === 'Escape') editing = null;
						}}
					/>
				{:else}
					<span class="val" title={r.display}>{r.display}</span>
				{/if}
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
	/* The + flow speaks the app's palette language: borderless rows with a
	   background wash for the armed item, one input, Enter commits. */
	.menu {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-bottom: 8px;
		outline: none;
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		background: none;
		border: none;
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-size: var(--font-ui-small);
		padding: 5px 8px;
		cursor: pointer;
		text-align: left;
	}
	.menu-item .material-symbols-outlined {
		font-size: 15px;
	}
	.menu-item.on {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.menu-item.on .material-symbols-outlined {
		color: var(--primary);
	}
	.addform {
		display: flex;
		gap: 4px;
		margin-bottom: 8px;
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
