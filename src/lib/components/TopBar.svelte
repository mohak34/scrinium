<script lang="ts">
	import { saveStatus } from '$lib/stores/vault';

	interface Props {
		path: string | null;
	}
	let { path }: Props = $props();

	const statusLabel: Record<string, string> = {
		idle: '',
		saving: 'Saving…',
		saved: 'Saved',
		error: 'Failed to save'
	};

	const segments = $derived(path ? path.split('/') : []);
</script>

<div class="topbar">
	<nav class="crumbs" aria-label="Breadcrumb">
		{#each segments as seg, i}
			<span class="crumb" class:last={i === segments.length - 1}>
				{#if i > 0}
					<span class="material-symbols-outlined crumb-sep">chevron_right</span>
				{/if}
				<span class="crumb-name">{seg.replace(/\.md$/, '')}</span>
			</span>
		{:else}
			<span class="crumb muted">No note open</span>
		{/each}
	</nav>
	<div class="actions">
		<span class="status" class:error={$saveStatus === 'error'}>{statusLabel[$saveStatus]}</span>
		<span class="material-symbols-outlined top-icon" title="Pin">push_pin</span>
		<span class="material-symbols-outlined top-icon" title="Share">share</span>
		<span class="material-symbols-outlined top-icon" title="More">more_vert</span>
	</div>
</div>

<style>
	.topbar {
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--stack-gap);
		padding: 0 var(--gutter);
		border-bottom: 1px solid var(--border-default);
		flex-shrink: 0;
		background: var(--background);
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		overflow: hidden;
		min-width: 0;
	}
	.crumb {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		white-space: nowrap;
	}
	.crumb.last {
		color: var(--on-surface);
	}
	.crumb.muted {
		color: var(--outline);
	}
	.crumb-sep {
		font-size: 14px;
		opacity: 0.5;
		color: var(--on-surface-variant);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		color: var(--on-surface-variant);
	}
	.top-icon {
		font-size: 18px;
		padding: 4px;
		border-radius: var(--radius);
		cursor: pointer;
	}
	.top-icon:hover {
		color: var(--on-surface);
		background: var(--surface-container-low);
	}
	.status {
		font-size: var(--font-ui-micro);
		color: var(--outline);
	}
	.status.error {
		color: var(--error);
	}
</style>
