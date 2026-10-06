<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { openTask, updateTask, stampShort, type Task } from '$lib/stores/tasks';

	interface Fired extends Task {
		firedAt: number;
	}

	let fired = $state<Fired[]>([]);
	let timer: ReturnType<typeof setInterval> | undefined;

	async function poll() {
		let due: Task[];
		try {
			const res = await fetch('/api/tasks/due', { method: 'POST', credentials: 'include' });
			if (!res.ok) return;
			due = (await res.json()) as Task[];
		} catch {
			return;
		}
		if (due.length === 0) return;
		// The server marks these fired as it returns them, so every one is
		// shown: none is skipped for being open in a drawer that may not even
		// be on screen, and none is cut by a cap.
		fired = [
			...due.filter((t) => !fired.some((f) => f.id === t.id)).map((t) => ({ ...t, firedAt: Date.now() })),
			...fired
		];
	}

	function dismiss(id: string) {
		fired = fired.filter((f) => f.id !== id);
	}

	function openFromToast(t: Fired) {
		dismiss(t.id);
		if (!page.url.pathname.startsWith('/tasks')) void goto('/tasks');
		openTask(t.id);
	}

	$effect(() => {
		void poll();
		timer = setInterval(() => void poll(), 30000);
		const onFocus = () => void poll();
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', onFocus);
		};
	});
</script>

{#if fired.length > 0}
	<div class="stack" role="region" aria-label="Task reminders">
		{#each fired as t (t.id)}
			<div class="toast">
				<span class="material-symbols-outlined bell">notifications</span>
				<div class="main">
					<span class="title">{t.title}</span>
					<span class="sub">Reminder{t.due_at != null ? ` · due ${stampShort(t.due_at)}` : ''}</span>
				</div>
				<button class="act" onclick={() => openFromToast(t)}>Open</button>
				<button
					class="act"
					onclick={() => {
						dismiss(t.id);
						void updateTask(t.id, { status: 'done' });
					}}
				>
					Done
				</button>
				<button class="x" onclick={() => dismiss(t.id)} aria-label="Dismiss reminder">
					<span class="material-symbols-outlined">close</span>
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.stack {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 100;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: min(360px, calc(100vw - 32px));
		max-height: calc(100vh - 32px);
		overflow-y: auto;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--surface-container-high);
		border: 1px solid var(--border-strong);
		border-left: 3px solid var(--tertiary);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
		padding: 10px 8px 10px 12px;
		animation: rise 0.16s ease;
	}
	@keyframes rise {
		from {
			transform: translateY(10px);
			opacity: 0.4;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	.bell {
		font-size: 20px;
		color: var(--tertiary);
		flex-shrink: 0;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title {
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: var(--font-ui-micro);
		color: var(--outline);
		font-variant-numeric: tabular-nums;
	}
	.act {
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-micro);
		padding: 4px 10px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.act:hover {
		color: var(--primary);
		border-color: var(--primary);
	}
	.x {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--outline);
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}
	.x .material-symbols-outlined {
		font-size: 16px;
	}
	.x:hover {
		color: var(--on-surface);
		background: var(--surface-container-highest);
	}
	.act:focus-visible,
	.x:focus-visible {
		outline: 1px solid var(--primary);
		outline-offset: 1px;
	}
	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
		}
	}
</style>
