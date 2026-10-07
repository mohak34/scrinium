<script lang="ts">
	import { tick } from 'svelte';
	import { settingsPage, type SettingsPage } from '$lib/stores/settingsDialog';
	import { trashEntries, loadTrash, tree, loadTree } from '$lib/stores/vault';
	import EditorPage from './EditorPage.svelte';
	import KeyboardPage from './KeyboardPage.svelte';
	import AttachmentsPage from './AttachmentsPage.svelte';
	import AccountPage from './AccountPage.svelte';
	import DevicesPage from './DevicesPage.svelte';
	import AgentsPage from './AgentsPage.svelte';
	import TrashPage from './TrashPage.svelte';
	import AboutPage from './AboutPage.svelte';

	// One dialog for preferences, account and vault housekeeping, mounted in
	// the root layout so every app opens the same thing.
	const GROUPS: { label: string; pages: { key: SettingsPage; title: string; icon: string }[] }[] = [
		{
			label: 'Preferences',
			pages: [
				{ key: 'editor', title: 'Editor', icon: 'edit_note' },
				{ key: 'keyboard', title: 'Keyboard', icon: 'keyboard' },
				{ key: 'attachments', title: 'Attachments', icon: 'attach_file' }
			]
		},
		{
			label: 'Account',
			pages: [
				{ key: 'account', title: 'Account', icon: 'person' },
				{ key: 'devices', title: 'Devices', icon: 'devices' },
				{ key: 'agents', title: 'Agents', icon: 'smart_toy' }
			]
		},
		{
			label: 'Vault',
			pages: [
				{ key: 'trash', title: 'Trash', icon: 'delete' },
				{ key: 'about', title: 'About', icon: 'info' }
			]
		}
	];
	const PAGES = GROUPS.flatMap((g) => g.pages);

	let dlg = $state<HTMLDivElement>();
	const current = $derived(PAGES.find((p) => p.key === $settingsPage));
	const isOpen = $derived($settingsPage !== null);

	const close = () => settingsPage.set(null);

	$effect(() => {
		if (!isOpen) return;
		void loadTrash();
		if ($tree.length === 0) void loadTree();
		const prev = document.activeElement as HTMLElement | null;
		void tick().then(() => dlg?.focus());

		// Modal: keys stay inside the dialog so app shortcuts (vim leader,
		// palette, tab switching) never fire underneath it. Default actions
		// still run, so typing and button activation work as usual.
		const onKey = (e: KeyboardEvent) => {
			e.stopPropagation();
			if (e.key === 'Escape') {
				e.preventDefault();
				close();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			prev?.focus?.();
		};
	});
</script>

{#if isOpen && current}
	<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && close()}>
		<div class="dlg" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1" bind:this={dlg}>
			<nav>
				{#each GROUPS as g (g.label)}
					<div class="lab">{g.label}</div>
					{#each g.pages as p (p.key)}
						<button class="ni" class:on={p.key === current.key} onclick={() => settingsPage.set(p.key)}>
							<span class="material-symbols-outlined" class:fill={p.key === current.key}>{p.icon}</span>
							{p.title}
							{#if p.key === 'trash' && $trashEntries.length}
								<span class="c">{$trashEntries.length}</span>
							{/if}
						</button>
					{/each}
				{/each}
			</nav>
			<section class="body">
				<header>
					<h2>{current.title}</h2>
					<span class="kbd">Esc</span>
					<button class="icon-btn" title="Close" onclick={close}>
						<span class="material-symbols-outlined">close</span>
					</button>
				</header>
				<div class="scroll">
					{#if current.key === 'editor'}<EditorPage />
					{:else if current.key === 'keyboard'}<KeyboardPage />
					{:else if current.key === 'attachments'}<AttachmentsPage />
					{:else if current.key === 'account'}<AccountPage />
					{:else if current.key === 'devices'}<DevicesPage />
				{:else if current.key === 'agents'}<AgentsPage />
					{:else if current.key === 'trash'}<TrashPage onRestored={close} />
					{:else}<AboutPage />
					{/if}
				</div>
			</section>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 950;
		background: var(--scrim);
		display: grid;
		place-items: center;
	}
	.dlg {
		width: min(920px, calc(100vw - 48px));
		height: min(640px, calc(100vh - 80px));
		background: var(--bg);
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		box-shadow: var(--shadow);
		display: flex;
		overflow: hidden;
		outline: none;
	}
	nav {
		width: 220px;
		flex-shrink: 0;
		background: var(--panel);
		border-right: 1px solid var(--line);
		padding: 8px 8px 14px;
		display: flex;
		flex-direction: column;
		gap: 1px;
		overflow-y: auto;
	}
	.lab {
		color: var(--text-4);
		font-size: var(--fs-xs);
		padding: 14px 10px 4px;
	}
	.ni {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 30px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font: var(--fs) var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.ni .material-symbols-outlined {
		color: var(--text-3);
	}
	.ni:hover {
		background: var(--hover);
		color: var(--text);
	}
	.ni.on {
		background: var(--accent-dim);
		color: var(--text);
	}
	.ni.on .material-symbols-outlined {
		color: var(--accent);
	}
	.c {
		margin-left: auto;
		color: var(--text-4);
		font: 11px var(--font-mono);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 54px;
		flex-shrink: 0;
		padding: 0 12px 0 28px;
		border-bottom: 1px solid var(--line);
	}
	h2 {
		flex: 1;
		margin: 0;
		font: 600 var(--fs-lg) var(--font-ui);
	}
	.icon-btn {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 4px 28px 28px;
	}

	/* Shared by every page component rendered inside the dialog. */
	.dlg :global(.row) {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 54px;
		padding: 10px 0;
		border-bottom: 1px solid var(--line);
	}
	.dlg :global(.row:last-child) {
		border-bottom: 0;
	}
	.dlg :global(.row .txt) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.dlg :global(.row .lbl) {
		font-size: var(--fs-md);
		color: var(--text);
	}
	.dlg :global(.row .hint) {
		font-size: var(--fs-sm);
		color: var(--text-3);
	}
	.dlg :global(.sub) {
		margin: 22px 0 2px;
		font: 600 var(--fs) var(--font-ui);
		color: var(--text-2);
	}
	.dlg :global(.empty) {
		padding: 28px 0;
		color: var(--text-3);
		font-size: var(--fs-sm);
	}
	.dlg :global(.btn) {
		height: 28px;
		padding: 0 11px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: var(--raise);
		color: var(--text);
		font: var(--fs-sm) var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
	}
	.dlg :global(.btn .material-symbols-outlined) {
		font-size: 16px;
	}
	.dlg :global(.btn:hover:not(:disabled)) {
		background: var(--hover);
		border-color: var(--line-3);
	}
	.dlg :global(.btn:disabled) {
		opacity: 0.5;
		cursor: default;
	}
	.dlg :global(.btn.primary) {
		background: var(--accent-fill);
		border-color: var(--accent-fill);
		color: var(--on-accent);
	}
	.dlg :global(.btn.primary:hover:not(:disabled)) {
		background: var(--accent-fill-hi);
		border-color: var(--accent-fill-hi);
	}
	.dlg :global(.btn.danger) {
		color: var(--red);
	}
	.dlg :global(.btn.danger:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--red) 12%, transparent);
		border-color: color-mix(in srgb, var(--red) 35%, transparent);
	}
	.dlg :global(.btn.ghost) {
		background: none;
		border-color: transparent;
		color: var(--text-2);
	}
	.dlg :global(.input) {
		width: 220px;
		height: 28px;
		padding: 0 10px;
		border: 1px solid var(--line-2);
		border-radius: var(--r);
		background: var(--panel);
		color: var(--text);
		font: 12px var(--font-mono);
	}
	.dlg :global(.input:focus) {
		outline: none;
		border-color: var(--accent);
	}
	.dlg :global(.mono) {
		font-family: var(--font-mono);
	}
</style>
