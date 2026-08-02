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
</script>

<div class="topbar">
	<span class="path">{path ?? 'No note open'}</span>
	<span class="status" class:error={$saveStatus === 'error'}>{statusLabel[$saveStatus]}</span>
</div>

<style>
	.topbar {
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 1rem;
		border-bottom: 1px solid #24262f;
		font-size: 0.78rem;
		color: #6b6e7a;
		flex-shrink: 0;
	}
	.status.error {
		color: #ff6b6b;
	}
</style>
