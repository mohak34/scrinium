<script lang="ts">
	let { on, label, onchange }: { on: boolean; label: string; onchange: () => void } = $props();
</script>

<button class="tgl" class:on role="switch" aria-checked={on} aria-label={label} onclick={onchange}></button>

<style>
	.tgl {
		width: 34px;
		height: 20px;
		flex-shrink: 0;
		position: relative;
		border: 0;
		border-radius: 10px;
		background: var(--line-3);
		cursor: pointer;
	}
	.tgl::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--text-2);
		transition: left 0.12s;
	}
	.tgl.on {
		background: var(--accent-fill);
	}
	.tgl.on::after {
		left: 17px;
		background: var(--on-accent);
	}
</style>
