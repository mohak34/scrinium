<script lang="ts">
	import { parseFrontmatter, stripFrontmatter, propDisplayRows } from '$lib/editor/frontmatter';

	interface Props {
		content: string;
	}
	let { content }: Props = $props();

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
	// box, so this card grows no save path.
	const extra = $derived.by(() => {
		if (!fm) return [];
		return propDisplayRows(fm).filter((r) => r.key !== 'status' && r.key !== 'priority');
	});

	function pill(value: string): string {
		const v = value.toLowerCase();
		if (['done', 'complete', 'completed', 'low'].includes(v)) return 'ok';
		if (['in progress', 'doing', 'medium'].includes(v)) return 'warn';
		if (['high', 'urgent', 'blocked'].includes(v)) return 'bad';
		return '';
	}
</script>

<section aria-label="File info">
	<header>
		<span class="title">File info</span>
	</header>
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
		font-size: var(--font-ui-micro);
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
