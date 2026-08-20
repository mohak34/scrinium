<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { settings, DEFAULT_SETTINGS } from '$lib/stores/settings';
	import { signOut } from '$lib/auth-client';

	let sessionEmail = $state<string | null>(null);
	let sessionLoading = $state(true);
	let sessionError = $state<string | null>(null);

	let tokens = $state<Array<{ token_hash: string; created_at: number; last_used_at: number | null }>>(
		[]
	);
	let tokensLoading = $state(false);
	let revokeBusy = $state<string | null>(null);
	let noteCount = $state<number | null>(null);
	let folderCount = $state<number | null>(null);

	// For display: copy feedback
	let copiedHash = $state<string | null>(null);

	onMount(() => {
		void loadSession();
		void loadTokens();
		void loadVaultStats();

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') goto('/');
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	async function loadSession() {
		sessionLoading = true;
		sessionError = null;
		try {
			// better-auth exposes get-session at /api/auth/get-session (via toSvelteKitHandler)
			const res = await fetch('/api/auth/get-session', { credentials: 'include' });
			if (!res.ok) {
				// fallback: try /api/auth/getSession naming variant
				const alt = await fetch('/api/auth/getSession', { credentials: 'include' });
				if (alt.ok) {
					const data = await alt.json();
					sessionEmail = data?.user?.email ?? data?.email ?? null;
					sessionLoading = false;
					return;
				}
				throw new Error(`${res.status}`);
			}
			const data = await res.json();
			// better-auth returns { user, session } or { user } depending on version
			sessionEmail = data?.user?.email ?? data?.email ?? data?.session?.user?.email ?? null;
		} catch {
			sessionError = 'Could not load session.';
		} finally {
			sessionLoading = false;
		}
	}

	async function loadTokens() {
		tokensLoading = true;
		try {
			const res = await fetch('/api/tokens', { credentials: 'include' });
			if (res.ok) tokens = await res.json();
		} catch {
			// ignore
		} finally {
			tokensLoading = false;
		}
	}

	async function revokeToken(hash: string) {
		if (!confirm('Revoke this mobile token? Devices using it will need to sign in again.')) return;
		revokeBusy = hash;
		try {
			const res = await fetch('/api/tokens', {
				method: 'DELETE',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token_hash: hash })
			});
			if (res.ok) tokens = tokens.filter((t) => t.token_hash !== hash);
		} finally {
			revokeBusy = null;
		}
	}

	async function loadVaultStats() {
		try {
			const res = await fetch('/api/tree', { credentials: 'include' });
			if (!res.ok) return;
			const tree = await res.json();
			let notes = 0;
			let folders = 0;
			function walk(entries: Array<{ type: string; children?: unknown[] }>) {
				for (const e of entries) {
					if (e.type === 'directory') {
						folders++;
						if (Array.isArray(e.children)) walk(e.children as Array<{ type: string; children?: unknown[] }>);
					} else {
						notes++;
					}
				}
			}
			walk(tree);
			noteCount = notes;
			folderCount = folders;
		} catch {
			// ignore
		}
	}

	function updateFontSize(delta: number) {
		settings.update((s) => {
			const next = Math.min(24, Math.max(10, s.editor.fontSize + delta));
			return { ...s, editor: { ...s.editor, fontSize: next } };
		});
	}

	function setFontSize(v: number) {
		settings.update((s) => ({ ...s, editor: { ...s.editor, fontSize: v } }));
	}

	function toggleLineNumbers() {
		settings.update((s) => ({ ...s, editor: { ...s.editor, showLineNumbers: !s.editor.showLineNumbers } }));
	}

	function toggleWrap() {
		settings.update((s) => ({ ...s, editor: { ...s.editor, wordWrap: !s.editor.wordWrap } }));
	}

	function resetSettings() {
		if (!confirm('Reset all settings to defaults?')) return;
		settings.reset();
	}

	function formatDate(ms: number) {
		try {
			return new Date(ms).toLocaleString();
		} catch {
			return String(ms);
		}
	}

	function copyHash(hash: string) {
		navigator.clipboard?.writeText(hash).catch(() => {});
		copiedHash = hash;
		setTimeout(() => {
			if (copiedHash === hash) copiedHash = null;
		}, 1500);
	}

	const editorSettings = $derived($settings.editor);
</script>

<div class="settings-page">
	<header class="settings-header">
		<button class="back" onclick={() => goto('/')}>
			<span class="material-symbols-outlined">arrow_back</span>
			Back to vault
		</button>
		<h1>Settings</h1>
		<p class="subtitle">Basic preferences. More will be added as needed — kept deliberately minimal.</p>
	</header>

	<div class="content">
		<!-- Account -->
		<section class="card">
			<div class="card-head">
				<h2>Account</h2>
				<span class="badge">server-backed</span>
			</div>
			{#if sessionLoading}
				<p class="muted">Loading session…</p>
			{:else if sessionError}
				<p class="muted">{sessionError}</p>
			{:else if sessionEmail}
				<div class="row">
					<div>
						<div class="label">Signed in as</div>
						<div class="value">{sessionEmail}</div>
						<div class="hint">Allowlist is set via ALLOWED_EMAILS on the server. Only listed addresses can sign in.</div>
					</div>
					<button class="btn secondary" onclick={signOut}>Sign out</button>
				</div>
			{:else}
				<p class="muted">No active session.</p>
				<a class="btn" href="/login">Go to login</a>
			{/if}

			<div class="divider"></div>

			<h3>Mobile access tokens</h3>
			<p class="hint">Long-lived tokens for the mobile client (POST /api/auth/mobile). Revoke any you no longer use — the device will need to re-authenticate with Google.</p>

			{#if tokensLoading}
				<p class="muted">Loading tokens…</p>
			{:else if tokens.length === 0}
				<p class="muted">No active mobile tokens.</p>
			{:else}
				<div class="token-list">
					{#each tokens as t (t.token_hash)}
						<div class="token">
							<div class="token-meta">
								<code class="hash" title={t.token_hash}>{t.token_hash.slice(0, 12)}…{t.token_hash.slice(-4)}</code>
								<span class="muted small">created {formatDate(t.created_at)}</span>
								{#if t.last_used_at}
									<span class="muted small">last used {formatDate(t.last_used_at)}</span>
								{:else}
									<span class="muted small">never used</span>
								{/if}
							</div>
							<div class="token-actions">
								<button
									class="btn ghost small"
									disabled={copiedHash === t.token_hash}
									onclick={() => copyHash(t.token_hash)}
									title="Copy full hash"
								>
									{copiedHash === t.token_hash ? 'Copied' : 'Copy hash'}
								</button>
								<button
									class="btn danger small"
									disabled={revokeBusy === t.token_hash}
									onclick={() => revokeToken(t.token_hash)}
								>
									{revokeBusy === t.token_hash ? 'Revoking…' : 'Revoke'}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Editor -->
		<section class="card">
			<div class="card-head">
				<h2>Editor</h2>
				<span class="badge">local</span>
			</div>
			<p class="hint">Stored in <code>localStorage</code> per browser. Plain files stay the source of truth.</p>

			<div class="field">
				<div class="field-head">
					<span class="label">Font size</span>
					<span class="value">{editorSettings.fontSize}px</span>
				</div>
				<div class="slider-row">
					<button class="btn ghost small" onclick={() => updateFontSize(-1)} disabled={editorSettings.fontSize <= 10}>−</button>
					<input
						type="range"
						min="10"
						max="24"
						step="1"
						value={editorSettings.fontSize}
						oninput={(e) => setFontSize(Number((e.target as HTMLInputElement).value))}
					/>
					<button class="btn ghost small" onclick={() => updateFontSize(1)} disabled={editorSettings.fontSize >= 24}>+</button>
				</div>
				<div class="hint">Applies to the CodeMirror editor only. Default 15px. Preview renders inline code with the same scale.</div>
			</div>

			<label class="toggle">
				<input type="checkbox" checked={editorSettings.showLineNumbers} onchange={toggleLineNumbers} />
				<span class="toggle-ui"></span>
				<span class="toggle-label">
					<span class="label">Show line numbers</span>
					<span class="hint">Gutter on the left of the editor. Turn off for a cleaner reading view.</span>
				</span>
			</label>

			<label class="toggle">
				<input type="checkbox" checked={editorSettings.wordWrap} onchange={toggleWrap} />
				<span class="toggle-ui"></span>
				<span class="toggle-label">
					<span class="label">Word wrap</span>
					<span class="hint">Wrap long lines instead of horizontal scrolling.</span>
				</span>
			</label>
		</section>

		<!-- Appearance -->
		<section class="card">
			<div class="card-head">
				<h2>Appearance</h2>
				<span class="badge">fixed</span>
			</div>
			<div class="row">
				<div>
					<div class="label">Theme</div>
					<div class="value">Dark — true black (#000) · Inter Variable</div>
					<div class="hint">Scrinium ships a single, information-dense dark theme. It is the intended look — no light theme yet to keep the surface small.</div>
				</div>
				<span class="material-symbols-outlined muted" style="font-size: 28px; opacity: 0.6">dark_mode</span>
			</div>
		</section>

		<!-- Vault -->
		<section class="card">
			<div class="card-head">
				<h2>Vault</h2>
				<span class="badge">read-only</span>
			</div>
			<div class="stats">
				<div class="stat">
					<span class="stat-value">{noteCount ?? '—'}</span>
					<span class="stat-label">files</span>
				</div>
				<div class="stat">
					<span class="stat-value">{folderCount ?? '—'}</span>
					<span class="stat-label">folders</span>
				</div>
				<div class="stat">
					<span class="stat-value">.md</span>
					<span class="stat-label">plain markdown on disk</span>
				</div>
			</div>
			<p class="hint">Every note is a <code>.md</code> file under <code>VAULT_DIR</code> on the server. The sqlite file at <code>DATABASE_PATH</code> is only a metadata/search cache — delete it to rebuild.</p>
		</section>

		<!-- About -->
		<section class="card">
			<div class="card-head">
				<h2>About</h2>
			</div>
			<div class="hint">
				Scrinium — notes that stay plain files. SvelteKit 5 + CodeMirror 6 live-preview, sqlite FTS search, Google OAuth allowlist.
				<br />
				Shortcuts: <code>Ctrl/Cmd+K</code> palette · <code>Ctrl/Cmd+F</code> find · <code>Esc</code> full preview · <code>Ctrl/Cmd+B</code> bold.
			</div>
			<div class="hint" style="margin-top: 10px">
				Docs: <code>AGENTS.md</code> (live-preview rules) · <code>DEPLOY.md</code> (VPS/Caddy/systemd).
			</div>
		</section>

		<!-- Danger -->
		<section class="card danger-zone">
			<h2>Danger zone</h2>
			<p class="hint">Local-only — does not touch vault files on disk.</p>
			<div class="row">
				<div>
					<div class="label">Reset settings</div>
					<div class="hint">Restore editor preferences to defaults and clear local pins/collapsed state if you confirm.</div>
				</div>
				<button class="btn danger" onclick={resetSettings}>Reset to defaults</button>
			</div>
		</section>

		<footer class="settings-footer">
			<span class="muted small">Keep it minimal. A setting earns its place when it prevents surprise.</span>
		</footer>
	</div>
</div>

<style>
	.settings-page {
		min-height: 100vh;
		background: var(--background);
		color: var(--on-surface);
		font-family: var(--font-ui);
		overflow-y: auto;
	}
	.settings-header {
		max-width: 720px;
		margin: 0 auto;
		padding: 28px var(--gutter) 16px;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: var(--on-surface-variant);
		font: inherit;
		font-size: var(--font-ui-small);
		cursor: pointer;
		padding: 0;
		margin-bottom: 16px;
	}
	.back:hover {
		color: var(--on-surface);
	}
	.settings-header h1 {
		margin: 0;
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		font-weight: var(--font-editor-title-weight);
		letter-spacing: var(--font-editor-title-tracking);
	}
	.subtitle {
		margin: 6px 0 0;
		color: var(--on-surface-variant);
		font-size: var(--font-ui-small);
	}
	.content {
		max-width: 720px;
		margin: 0 auto;
		padding: 0 var(--gutter) 48px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.card {
		background: var(--surface-container);
		border: 1px solid var(--border-raised);
		border-radius: var(--radius-lg);
		padding: 16px;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 12px;
	}
	.card h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--on-surface);
	}
	.card h3 {
		margin: 16px 0 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--on-surface);
	}
	.badge {
		font-size: var(--font-ui-micro);
		color: var(--outline);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		padding: 2px 8px;
		text-transform: uppercase;
		letter-spacing: var(--label-caps-spacing);
	}
	.label {
		font-size: var(--font-ui-medium);
		font-weight: 500;
		color: var(--on-surface);
	}
	.value {
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
		margin-top: 2px;
	}
	.hint {
		font-size: var(--font-ui-small);
		color: var(--outline);
		line-height: 1.5;
		margin: 4px 0 0;
	}
	.muted {
		color: var(--outline);
	}
	.small {
		font-size: var(--font-ui-micro);
	}
	.row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.divider {
		height: 1px;
		background: var(--border-default);
		margin: 16px 0;
	}
	.field {
		padding: 12px;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		margin-bottom: 12px;
	}
	.field-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.slider-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 10px;
	}
	.slider-row input[type='range'] {
		flex: 1;
		accent-color: var(--primary);
	}
	.toggle {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		margin-bottom: 8px;
		cursor: pointer;
		user-select: none;
	}
	.toggle input {
		display: none;
	}
	.toggle-ui {
		width: 36px;
		height: 20px;
		border-radius: 999px;
		background: var(--surface-container-highest);
		border: 1px solid var(--border-default);
		position: relative;
		flex-shrink: 0;
		margin-top: 2px;
		transition: background 0.15s ease, border-color 0.15s ease;
	}
	.toggle-ui::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--on-surface-variant);
		transition: transform 0.15s ease, background 0.15s ease;
	}
	.toggle input:checked + .toggle-ui {
		background: var(--primary);
		border-color: var(--primary);
	}
	.toggle input:checked + .toggle-ui::after {
		transform: translateX(16px);
		background: var(--on-primary);
	}
	.toggle-label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.stats {
		display: flex;
		gap: 16px;
		margin: 8px 0 12px;
	}
	.stat {
		flex: 1;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		padding: 12px;
		text-align: center;
	}
	.stat-value {
		display: block;
		font-size: 20px;
		font-weight: 600;
		color: var(--on-surface);
		line-height: 1;
	}
	.stat-label {
		font-size: var(--font-ui-micro);
		color: var(--outline);
		text-transform: uppercase;
		letter-spacing: var(--label-caps-spacing);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border-radius: var(--radius);
		border: 1px solid transparent;
		font: inherit;
		font-size: var(--font-ui-small);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		background: var(--primary);
		color: var(--on-primary);
		text-decoration: none;
	}
	.btn:hover {
		filter: brightness(1.05);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.secondary {
		background: var(--surface-container-high);
		color: var(--on-surface);
		border-color: var(--border-default);
	}
	.btn.ghost {
		background: transparent;
		color: var(--on-surface-variant);
		border-color: var(--border-default);
	}
	.btn.danger {
		background: var(--error-container);
		color: var(--on-error-container);
		border-color: transparent;
	}
	.btn.danger:hover {
		filter: brightness(1.1);
	}
	.btn.small {
		height: 26px;
		padding: 0 8px;
		font-size: 11px;
	}
	.token-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 10px;
	}
	.token {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		background: var(--surface-container-low);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
	}
	.token-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.hash {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--on-surface);
		background: var(--surface-container-high);
		padding: 2px 6px;
		border-radius: 4px;
		word-break: break-all;
	}
	.token-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.danger-zone {
		border-color: #3a2323;
		background: #1c1518;
	}
	.danger-zone h2 {
		color: var(--error);
	}
	.settings-footer {
		padding: 4px 2px;
		text-align: center;
	}
	code {
		font-family: var(--font-mono);
		background: var(--surface-container-high);
		padding: 0.1em 0.3em;
		border-radius: 4px;
		font-size: 0.92em;
	}
</style>
