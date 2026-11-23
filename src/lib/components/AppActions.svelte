<script lang="ts">
	import { onMount } from 'svelte';
	import ContextMenu from './ContextMenu.svelte';
	import { openSettings } from '$lib/stores/settingsDialog';
	import { openBins } from '$lib/stores/bins';
	import { signOut } from '$lib/auth-client';

	// The account chip at the bottom left of Notes, Tasks and Board: opens a
	// menu with Settings, Archive, Trash and Sign out.
	let user = $state<{ email?: string; name?: string; image?: string | null } | null>(null);
	let imageFailed = $state(false);
	let button = $state<HTMLButtonElement>();
	let at = $state<DOMRect | null>(null);

	onMount(async () => {
		const session = await fetch('/api/auth/get-session')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		user = session?.user ?? null;
	});

	const initial = $derived((user?.name || user?.email)?.[0]?.toUpperCase());
</script>

<button
	bind:this={button}
	class="acct"
	class:open={!!at}
	title={user?.email ?? 'Account'}
	aria-haspopup="menu"
	aria-expanded={!!at}
	onclick={() => (at = at ? null : (button?.getBoundingClientRect() ?? null))}
>
	<span class="avatar">
		{#if user?.image && !imageFailed}
			<img src={user.image} alt="" referrerpolicy="no-referrer" onerror={() => (imageFailed = true)} />
		{:else if initial}
			{initial}
		{:else}
			<span class="material-symbols-outlined">person</span>
		{/if}
	</span>
	<span class="lbl">Account</span>
	<span class="material-symbols-outlined chev">unfold_more</span>
</button>
{#if at}
	<ContextMenu
		x={at.left}
		y={at.top - 4}
		width={200}
		anchor={button}
		above
		items={[
			{ label: 'Settings', icon: 'settings', action: () => openSettings() },
			{ label: 'Archive', icon: 'inventory_2', action: () => openBins('archive') },
			{ label: 'Trash', icon: 'delete', action: () => openBins('trash') },
			{ label: 'Sign out', icon: 'logout', divider: true, action: signOut }
		]}
		onClose={() => (at = null)}
	/>
{/if}

<style>
	.acct {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 6px 0 4px;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--text-2);
		font: inherit;
		font-size: var(--t-caption);
		cursor: pointer;
		flex-shrink: 0;
	}
	.acct:hover,
	.acct.open {
		background: var(--hover);
		color: var(--text);
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		overflow: hidden;
		background: var(--accent-fill);
		color: #fff;
		font-size: 11px;
		font-weight: 600;
	}
	.avatar .material-symbols-outlined {
		font-size: 15px;
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.chev {
		font-size: 16px;
		color: var(--text-3);
	}
</style>
