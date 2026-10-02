<script lang="ts">
	import { onMount } from 'svelte';
	import { signOut, connectCalendar } from '$lib/auth-client';

	let email = $state<string | null>(null);
	let loading = $state(true);
	// The events endpoint reports needsConnect when the Google grant lacks
	// the calendar scope, so a 1 ms window is the probe. null while checking
	// or when Google is unreachable: no row state beats a wrong one.
	let calendar = $state<'connected' | 'disconnected' | null>(null);

	onMount(async () => {
		const now = Date.now();
		const [session, events] = await Promise.all([
			fetch('/api/auth/get-session').then((r) => (r.ok ? r.json() : null)).catch(() => null),
			fetch(`/api/calendar/events?from=${now}&to=${now + 1}`)
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null)
		]);
		email = session?.user?.email ?? null;
		loading = false;
		if (events) calendar = events.needsConnect ? 'disconnected' : 'connected';
	});
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
		<span class="hint">Read-only events on the task calendar</span>
	</div>
	{#if calendar === 'connected'}
		<span class="state"><span class="dot"></span>Connected</span>
	{:else if calendar === 'disconnected'}
		<button class="btn" onclick={() => void connectCalendar()}>
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
