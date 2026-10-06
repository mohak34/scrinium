<script lang="ts">
	import { onMount } from 'svelte';
	import { signOut, connectCalendar } from '$lib/auth-client';

	let email = $state<string | null>(null);
	let loading = $state(true);
	// null while checking or when Google is unreachable: no row state beats
	// a wrong one.
	let calendar = $state<'connected' | 'disconnected' | null>(null);
	let connectFailed = $state(false);

	onMount(async () => {
		const [session, status] = await Promise.all([
			fetch('/api/auth/get-session').then((r) => (r.ok ? r.json() : null)).catch(() => null),
			fetch('/api/calendar/status')
				.then((r) => (r.ok ? (r.json() as Promise<{ connected: boolean }>) : null))
				.catch(() => null)
		]);
		email = session?.user?.email ?? null;
		loading = false;
		if (status) calendar = status.connected ? 'connected' : 'disconnected';
	});

	async function connect() {
		connectFailed = false;
		try {
			await connectCalendar();
		} catch {
			connectFailed = true;
		}
	}
</script>

<div class="row">
	<span class="avatar">{email?.[0]?.toUpperCase() ?? '?'}</span>
	<div class="txt">
		<span class="lbl">{loading ? 'Loading...' : (email ?? 'Not signed in')}</span>
		<span class="hint">Google sign-in, checked against the server allowlist</span>
	</div>
	{#if email}
		<button class="btn" onclick={signOut}><span class="material-symbols-outlined">logout</span>Sign out</button>
	{/if}
</div>
<div class="row">
	<span class="material-symbols-outlined cal">calendar_month</span>
	<div class="txt">
		<span class="lbl">Google Calendar</span>
		<span class="hint">{connectFailed ? 'Could not reach Google. Try again' : 'Read-only events from your selected calendars'}</span>
	</div>
	{#if calendar === 'connected'}
		<span class="state"><span class="dot"></span>Connected</span>
	{:else if calendar === 'disconnected'}
		<button class="btn" onclick={() => void connect()}>
			<span class="material-symbols-outlined">add_link</span>Connect
		</button>
	{/if}
</div>

<style>
	.avatar {
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--accent-fill);
		color: var(--on-accent);
		font-weight: 600;
	}
	.cal {
		width: 30px;
		text-align: center;
		font-size: 20px;
		color: var(--blue);
	}
	.state {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-sm);
		color: var(--text-2);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--green);
	}
</style>
