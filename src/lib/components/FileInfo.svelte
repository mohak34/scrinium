<script lang="ts">
	import { parseFrontmatter, stripFrontmatter, propDisplayRows } from '$lib/editor/frontmatter';
	import { activePath, updateFrontmatter } from '$lib/stores/vault';
import { renameKey } from '$lib/editor/frontmatter';

	interface Props {
		content: string;
		onClose: () => void;
	}
	let { content, onClose }: Props = $props();

	type AddKind = 'text' | 'status' | 'priority' | 'date';
	const ADD_TYPES: Array<{ id: AddKind; icon: string; label: string; hint: string }> = [
		{ id: 'text', icon: 'text_fields', label: 'Custom', hint: 'Any key and value' },
		{ id: 'status', icon: 'flag', label: 'Status', hint: 'Not started, In progress, Done' },
		{ id: 'priority', icon: 'priority_high', label: 'Priority', hint: 'Low, Medium, High' },
		{ id: 'date', icon: 'calendar_month', label: 'Date', hint: "Today's date, MM/DD/YYYY" }
	];
	const PRESETS: Record<string, string[]> = {
		status: ['Not started', 'In progress', 'Done'],
		priority: ['Low', 'Medium', 'High']
	};

	let adding = $state<AddKind | null>(null);
	let menuOpen = $state(false);
	let menuIndex = $state(0);
	let fieldKey = $state('');
	let fieldValue = $state('');
	let saving = $state(false);
	let editing = $state<{ key: string; field: 'key' | 'value' } | null>(null);
	let editValue = $state('');
	let editCustom = $state(false);
	let menuEl = $state<HTMLDivElement>();

	function takeFocus(el: HTMLInputElement) {
		el.focus();
	}

	function usToday(): string {
		const d = new Date();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${mm}/${dd}/${d.getFullYear()}`;
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
				doc.set(key, value);
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
		fieldValue = kind === 'date' ? usToday() : '';
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

	function startEdit(key: string, field: 'key' | 'value') {
		if (saving || !$activePath) return;
		if (field === 'value') {
			const d = displayOf(key);
			if (d === null) return;
			editValue = d;
		} else {
			editValue = key;
		}
		editing = { key, field };
		editCustom = false;
	}

	async function commitEdit(key: string, field: 'key' | 'value') {
		if (editing?.key !== key || editing.field !== field) return;
		editing = null;
		const path = $activePath;
		if (!path || saving) return;
		const raw = editValue.trim();
		if (field === 'key') {
			if (!raw || raw === key) return;
			saving = true;
			try {
				await updateFrontmatter(path, (doc) => {
					renameKey(doc, key, raw);
				});
			} finally {
				saving = false;
			}
			return;
		}
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

	// One icon per key so custom properties sit evenly beside the premade
	// rows; unknown keys get the generic tag icon, never bare text.
	const KEY_ICONS: Record<string, string> = {
		title: 'title',
		author: 'person',
		date: 'calendar_month',
		course: 'school',
		tags: 'tag',
		status: 'flag',
		priority: 'priority_high',
		description: 'description',
		source: 'link'
	};
	function iconFor(key: string): string {
		return KEY_ICONS[key.toLowerCase()] ?? 'label';
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
		<button class="add-toggle" onclick={onClose} title="Close panel">
			<span class="material-symbols-outlined">close</span>
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
		{#if (adding === 'status' || adding === 'priority') && PRESETS[adding].length}
			<div class="menu presets">
				{#each PRESETS[adding] as p (p)}
					<button
						class="menu-item"
						onclick={() => {
							fieldValue = p;
							void saveAdd();
						}}
					>
						<span class="pill {pill(p)}">{p}</span>
					</button>
				{/each}
			</div>
		{/if}
		<div class="addform">
			{#if adding === 'text'}
				<input
					class="in key"
					placeholder="name"
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
				placeholder={adding === 'date'
					? 'MM/DD/YYYY'
					: adding === 'text'
						? 'value…'
						: 'Custom value…'}
				use:takeFocus
				bind:value={fieldValue}
				disabled={saving}
				onkeydown={(e) => {
					if (e.key === 'Enter') void saveAdd();
					if (e.key === 'Escape') adding = null;
				}}
			/>
		</div>
	{/if}
	<div class="card">
		{#snippet keyInput(key: string)}
			<input
				class="in key-edit"
				use:takeFocus
				bind:value={editValue}
				disabled={saving}
				onfocus={(e) => e.currentTarget.select()}
				onblur={() => void commitEdit(key, 'key')}
				onkeydown={(e) => {
					if (e.key === 'Enter') void commitEdit(key, 'key');
					if (e.key === 'Escape') editing = null;
				}}
			/>
		{/snippet}
		{#snippet valueInput(key: string)}
			{#if (key === 'status' || key === 'priority') && !editCustom}
				<div class="menu presets">
					{#each PRESETS[key] as p (p)}
						<button
							class="menu-item"
							onclick={() => {
								editValue = p;
								void commitEdit(key, 'value');
							}}
						>
							<span class="pill {pill(p)}">{p}</span>
						</button>
					{/each}
					<button class="menu-item" onclick={() => (editCustom = true)}>
						<span class="material-symbols-outlined">edit</span>
						Custom…
					</button>
				</div>
			{:else}
				<input
					class="in"
					use:takeFocus
					bind:value={editValue}
					disabled={saving}
					onfocus={(e) => e.currentTarget.select()}
					onblur={() => void commitEdit(key, 'value')}
					onkeydown={(e) => {
						if (e.key === 'Enter') void commitEdit(key, 'value');
						if (e.key === 'Escape') editing = null;
					}}
				/>
			{/if}
		{/snippet}
		{#snippet editableLabel(key: string, text: string)}
			<span
				class="label edit"
				role="button"
				tabindex="0"
				title="Double-click to rename"
				ondblclick={() => startEdit(key, 'key')}
				onkeydown={(e) => {
					if (e.key === 'Enter') startEdit(key, 'key');
				}}
			>
				<span class="material-symbols-outlined">{iconFor(key)}</span>
				{text}
			</span>
		{/snippet}
		{#if status}
			<div
				class="row{editing?.key === 'status' && editing.field === 'value' && !editCustom
					? ' menu-open'
					: ''}"
			>
				{#if editing?.key === 'status' && editing.field === 'key'}
					{@render keyInput('status')}
				{:else}
					<span class="label">
						{@render editableLabel('status', 'Status')}
					</span>
				{/if}
				{#if editing?.key === 'status' && editing.field === 'value'}
					{@render valueInput('status')}
				{:else}
					<span
						class="pill {pill(status)}"
						role="button"
						tabindex="0"
						title="Double-click to edit"
						ondblclick={() => startEdit('status', 'value')}
						onkeydown={(e) => {
							if (e.key === 'Enter') startEdit('status', 'value');
						}}
					>
						{status}
					</span>
				{/if}
			</div>
		{/if}
		{#if priority}
			<div
				class="row{editing?.key === 'priority' && editing.field === 'value' && !editCustom
					? ' menu-open'
					: ''}"
			>
				{#if editing?.key === 'priority' && editing.field === 'key'}
					{@render keyInput('priority')}
				{:else}
					<span class="label">
						{@render editableLabel('priority', 'Priority')}
					</span>
				{/if}
				{#if editing?.key === 'priority' && editing.field === 'value'}
					{@render valueInput('priority')}
				{:else}
					<span
						class="pill {pill(priority)}"
						role="button"
						tabindex="0"
						title="Double-click to edit"
						ondblclick={() => startEdit('priority', 'value')}
						onkeydown={(e) => {
							if (e.key === 'Enter') startEdit('priority', 'value');
						}}
					>
						{priority}
					</span>
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
			<div class="row">
				{#if editing?.key === r.key && editing.field === 'key'}
					{@render keyInput(r.key)}
				{:else}
					{@render editableLabel(r.key, r.key)}
				{/if}
				{#if editing?.key === r.key && editing.field === 'value'}
					{@render valueInput(r.key)}
				{:else}
					<span
						class="val"
						role="button"
						tabindex="0"
						title="Double-click to edit"
						ondblclick={() => startEdit(r.key, 'value')}
						onkeydown={(e) => {
							if (e.key === 'Enter') startEdit(r.key, 'value');
						}}
					>
						{r.display}
					</span>
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
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: var(--font-ui-small);
		padding: 5px 0;
		border-top: 1px solid var(--border-default);
	}
	.row:first-child {
		border-top: none;
		padding-top: 0;
	}
	/* Preset picking stacks full-width; the label hides while choosing. */
	.row.menu-open {
		flex-direction: column;
		align-items: stretch;
	}
	.row.menu-open .label {
		display: none;
	}
	.label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--on-surface-variant);
		font-weight: 600;
	}
	.label .material-symbols-outlined {
		font-size: 14px;
	}
	.label.edit {
		cursor: text;
		border-radius: var(--radius);
	}
	.label.edit:hover {
		color: var(--primary);
	}
	.in.key-edit {
		flex: 0 1 90px;
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
		background: var(--sidebar-bg);
		color: var(--on-surface);
	}
	.menu-item.on .material-symbols-outlined {
		color: var(--primary);
	}
	.menu.presets {
		margin-bottom: 4px;
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
		background: var(--sidebar-bg);
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
		background: var(--sidebar-bg);
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
