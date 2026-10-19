<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tree, loadTree } from '$lib/stores/vault';
	import { projects, createProject, newProjectOpen } from '$lib/stores/tasks';
	import { boardHref } from '$lib/projects';

	// Names a new project (its folder is created at the vault root) or turns
	// an existing top-level folder into one. Mounted by the root layout.
	let name = $state('');
	let error = $state('');
	let busy = $state(false);

	const folders = $derived(
		$tree.filter((e) => e.type === 'directory' && !$projects.some((p) => p.path === e.path))
	);

	const close = () => newProjectOpen.set(false);

	async function create(path: string) {
		if (busy || !path.trim()) return;
		busy = true;
		error = '';
		const row = await createProject(path.trim());
		busy = false;
		if (typeof row === 'string') {
			error = row;
			return;
		}
		close();
		await loadTree();
		if (page.url.pathname.startsWith('/tasks/kanban')) void goto(boardHref({ project: row.path }));
	}

	// Keys stay in the dialog (app shortcuts never fire underneath); their
	// defaults still run, so typing and Enter-to-submit work. Esc closes.
	onMount(() => {
		if ($tree.length === 0) void loadTree();
		const onKey = (e: KeyboardEvent) => {
			e.stopPropagation();
			if (e.key === 'Escape') {
				e.preventDefault();
				close();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && close()}>
	<form
		class="dlg"
		aria-label="New project"
		onsubmit={(e) => {
			e.preventDefault();
			void create(name);
		}}
	>
		<div class="title">New project</div>
		<!-- svelte-ignore a11y_autofocus -->
		<input bind:value={name} placeholder="Project name" autofocus spellcheck="false" />
		<div class="hint">
			{#if error}<span class="err">{error}</span>
			{:else if name.trim()}Creates the folder {name.trim()}/ at the vault root.
			{:else}A project is a folder at the vault root with its own board.{/if}
		</div>
		{#if folders.length > 0}
			<div class="lab">Or turn a top-level folder into a project</div>
			<div class="folders">
				{#each folders as f (f.path)}
					<button type="button" class="folder" disabled={busy} onclick={() => void create(f.path)}>
						<span class="material-symbols-outlined">folder</span>{f.name}
					</button>
				{/each}
			</div>
		{/if}
		<div class="actions">
			<button type="button" class="ghost" onclick={close}>Cancel</button>
			<button type="submit" class="solid" disabled={busy || !name.trim()}>Create</button>
		</div>
	</form>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: var(--scrim);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 14vh;
	}
	.dlg {
		width: min(420px, calc(100vw - 2rem));
		background: var(--raise);
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		padding: 16px;
		color: var(--text);
		font: var(--fs) var(--font-ui);
	}
	.title {
		font-weight: 600;
		margin-bottom: 12px;
	}
	input {
		width: 100%;
		height: 34px;
		padding: 0 10px;
		background: var(--bg);
		border: 1px solid var(--line-3);
		border-radius: var(--r);
		color: var(--text);
		font: inherit;
		outline: none;
	}
	input:focus {
		border-color: var(--accent);
	}
	.hint {
		margin: 6px 0 14px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.err {
		color: var(--red);
	}
	.lab {
		margin-bottom: 4px;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.folders {
		max-height: 200px;
		overflow-y: auto;
	}
	.folder {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 29px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.folder:hover {
		background: var(--hover);
		color: var(--text);
	}
	.folder .material-symbols-outlined {
		font-size: 16px;
		color: var(--text-3);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 14px;
	}
	.actions button {
		height: 30px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r);
		font: inherit;
		cursor: pointer;
	}
	.ghost {
		background: none;
		color: var(--text-2);
	}
	.ghost:hover {
		background: var(--hover);
		color: var(--text);
	}
	.solid {
		background: var(--accent-fill);
		color: var(--on-accent);
	}
	.solid:hover:not(:disabled) {
		background: var(--accent-fill-hi);
	}
	.solid:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
