<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { settings, DEFAULT_SETTINGS, type AttachmentLocation } from '$lib/stores/settings';
	import { signOut } from '$lib/auth-client';

	let sessionEmail = $state<string | null>(null);
	let sessionLoading = $state(true);

	let tokens = $state<Array<{ token_hash: string; created_at: number; last_used_at: number | null }>>(
		[]
	);
	let tokensLoading = $state(false);
	let revokeBusy = $state<string | null>(null);
	let noteCount = $state<number | null>(null);
	let folderCount = $state<number | null>(null);
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
		try {
			const res = await fetch('/api/auth/get-session', { credentials: 'include' });
			if (res.ok) {
				const data = await res.json();
				sessionEmail = data?.user?.email ?? data?.email ?? null;
			}
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
			// leave the list empty
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
						if (Array.isArray(e.children)) {
							walk(e.children as Array<{ type: string; children?: unknown[] }>);
						}
					} else {
						notes++;
					}
				}
			}
			walk(tree);
			noteCount = notes;
			folderCount = folders;
		} catch {
			// stats are best-effort
		}
	}

	function setFontSize(v: number) {
		settings.update((s) => ({ ...s, editor: { ...s.editor, fontSize: v } }));
	}

	function toggleLineNumbers() {
		settings.update((s) => ({
			...s,
			editor: { ...s.editor, showLineNumbers: !s.editor.showLineNumbers }
		}));
	}

	function toggleWrap() {
		settings.update((s) => ({ ...s, editor: { ...s.editor, wordWrap: !s.editor.wordWrap } }));
	}

	function resetSettings() {
		if (!confirm('Reset all settings to defaults?')) return;
		settings.reset();
	}

	function setAttachmentLocation(loc: AttachmentLocation) {
		settings.update((s) => ({ ...s, attachments: { ...s.attachments, location: loc } }));
	}

	function setAttachmentFolder(v: string) {
		settings.update((s) => ({
			...s,
			attachments: { ...s.attachments, folder: v.split('/').map((p) => p.trim()).filter(Boolean).join('/') }
		}));
	}

	function setAttachmentName(v: string) {
		settings.update((s) => ({
			...s,
			attachments: { ...s.attachments, name: v.trim() || DEFAULT_SETTINGS.attachments.name }
		}));
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
	const attachmentSettings = $derived($settings.attachments);

	const ATTACHMENT_OPTIONS: { value: AttachmentLocation; label: string; hint: string }[] = [
		{
			value: 'vault',
			label: 'Fixed folder in vault root',
			hint: 'Everything lands in one folder at the top level. Name it below.'
		},
		{
			value: 'note',
			label: 'Same folder as current note',
			hint: 'Pastes sit next to the note you are editing.'
		},
		{
			value: 'subfolder',
			label: 'Subfolder under current note',
			hint: 'A named subfolder next to the note, e.g. projects/site/<name>/.'
		},
		{ value: 'root', label: 'Vault root', hint: 'Files land at the top level of the vault.' },
		{
			value: 'custom',
			label: 'Custom folder path',
			hint: 'Any vault-relative path, e.g. media/pasted.'
		}
	];

</script>

<div class="page">
	<header class="topbar">
		<div class="left">
			<button class="icon-btn" onclick={() => goto('/')} title="Back to vault (Esc)">
				<span class="material-symbols-outlined">arrow_back</span>
			</button>
			<span class="title">Settings</span>
		</div>
	</header>

	<div class="scroll">
		<div class="content">
			<section>
				<h2>Editor</h2>
				<p class="section-hint">Stored per browser. Plain files stay the source of truth.</p>
				<div class="rows">
					<div class="row">
						<div class="row-text">
							<span class="label">Font size</span>
							<span class="hint">Applies to the note editor.</span>
						</div>
						<div class="stepper">
							<button
								class="icon-btn"
								title="Smaller"
								disabled={editorSettings.fontSize <= 10}
								onclick={() => setFontSize(editorSettings.fontSize - 1)}
							>
								<span class="material-symbols-outlined">remove</span>
							</button>
							<input
								type="range"
								min="10"
								max="24"
								step="1"
								value={editorSettings.fontSize}
								oninput={(e) => setFontSize(Number((e.target as HTMLInputElement).value))}
							/>
							<button
								class="icon-btn"
								title="Larger"
								disabled={editorSettings.fontSize >= 24}
								onclick={() => setFontSize(editorSettings.fontSize + 1)}
							>
								<span class="material-symbols-outlined">add</span>
							</button>
							<span class="value mono">{editorSettings.fontSize}px</span>
						</div>
					</div>
					<label class="row toggle-row">
						<div class="row-text">
							<span class="label">Show line numbers</span>
							<span class="hint">Gutter on the left of the editor.</span>
						</div>
						<input
							type="checkbox"
							checked={editorSettings.showLineNumbers}
							onchange={toggleLineNumbers}
						/>
						<span class="switch"></span>
					</label>
					<label class="row toggle-row">
						<div class="row-text">
							<span class="label">Word wrap</span>
							<span class="hint">Wrap long lines instead of scrolling sideways.</span>
						</div>
						<input type="checkbox" checked={editorSettings.wordWrap} onchange={toggleWrap} />
						<span class="switch"></span>
					</label>
					<div class="row">
						<div class="row-text">
							<span class="label">Reset</span>
							<span class="hint">Restore editor settings to defaults.</span>
						</div>
						<button class="btn" onclick={resetSettings}>Reset</button>
					</div>
				</div>
			</section>

			<section>
				<h2>Attachments</h2>
				<p class="section-hint">Where pasted images are stored. Applies to new pastes only; existing files stay where they are.</p>
				<div class="rows">
					{#each ATTACHMENT_OPTIONS as opt (opt.value)}
						<label class="row radio-row">
							<input
								type="radio"
								name="attachment-location"
								value={opt.value}
								checked={attachmentSettings.location === opt.value}
								onchange={() => setAttachmentLocation(opt.value)}
							/>
							<span class="radio-ui"></span>
							<span class="row-text grow">
								<span class="label">{opt.label}</span>
								<span class="hint">{opt.hint}</span>
							</span>
						</label>
						{#if opt.value === 'vault' && attachmentSettings.location === 'vault'}
							<div class="row">
								<div class="row-text">
									<span class="label">Folder name</span>
									<span class="hint">Default is "attachments".</span>
								</div>
								<input
									class="text-input mono"
									value={attachmentSettings.name}
									placeholder={DEFAULT_SETTINGS.attachments.name}
									spellcheck="false"
									onchange={(e) => setAttachmentName((e.target as HTMLInputElement).value)}
								/>
							</div>
						{/if}
						{#if opt.value === 'subfolder' && attachmentSettings.location === 'subfolder'}
							<div class="row">
								<div class="row-text">
									<span class="label">Subfolder name</span>
									<span class="hint">Default is "assets".</span>
								</div>
								<input
									class="text-input mono"
									value={attachmentSettings.name}
									placeholder={DEFAULT_SETTINGS.attachments.name}
									spellcheck="false"
									onchange={(e) => setAttachmentName((e.target as HTMLInputElement).value)}
								/>
							</div>
						{/if}
						{#if opt.value === 'custom' && attachmentSettings.location === 'custom'}
							<div class="row">
								<div class="row-text">
									<span class="label">Path</span>
									<span class="hint">
										Vault-relative path, e.g.
										{attachmentSettings.folder ? attachmentSettings.folder : 'media/pasted'}
									</span>
								</div>
								<input
									class="text-input mono"
									value={attachmentSettings.folder}
									placeholder="media/pasted"
									spellcheck="false"
									onchange={(e) => setAttachmentFolder((e.target as HTMLInputElement).value)}
								/>
							</div>
						{/if}
					{/each}
				</div>
			</section>

			<section>
				<h2>Account</h2>
				<div class="rows">
					<div class="row">
						<div class="row-text">
							<span class="label">Signed in as</span>
							<span class="hint">
								{#if sessionLoading}
									Loading…
								{:else if sessionEmail}
									{sessionEmail} · allowlist is set via ALLOWED_EMAILS on the server
								{:else}
									No active session
								{/if}
							</span>
						</div>
						{#if sessionEmail}
							<button class="btn" onclick={signOut}>Sign out</button>
						{/if}
					</div>
				</div>

				<h3>Mobile access tokens</h3>
				<p class="section-hint">
					Long-lived tokens issued to the mobile client. Revoke any you no longer use; that device
					will need to sign in again.
				</p>
				<div class="rows">
					{#if tokensLoading}
						<div class="row"><span class="hint">Loading…</span></div>
					{:else if tokens.length === 0}
						<div class="row"><span class="hint">No active mobile tokens.</span></div>
					{:else}
						{#each tokens as t (t.token_hash)}
							<div class="row">
								<div class="row-text">
									<code class="hash">{t.token_hash.slice(0, 12)}…{t.token_hash.slice(-4)}</code>
									<span class="hint">
										created {formatDate(t.created_at)} ·
										{t.last_used_at ? `last used ${formatDate(t.last_used_at)}` : 'never used'}
									</span>
								</div>
								<div class="btn-group">
									<button
										class="btn"
										disabled={copiedHash === t.token_hash}
										onclick={() => copyHash(t.token_hash)}
										title="Copy full hash"
									>
										{copiedHash === t.token_hash ? 'Copied' : 'Copy'}
									</button>
									<button class="btn danger" disabled={revokeBusy === t.token_hash} onclick={() => revokeToken(t.token_hash)}>
										{revokeBusy === t.token_hash ? 'Revoking…' : 'Revoke'}
									</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<section>
				<h2>Vault</h2>
				<div class="rows">
					<div class="row">
						<div class="stat">
							<span class="stat-value">{noteCount ?? '—'}</span>
							<span class="stat-label">notes</span>
						</div>
						<div class="stat">
							<span class="stat-value">{folderCount ?? '—'}</span>
							<span class="stat-label">folders</span>
						</div>
						<div class="row-text grow">
							<span class="label">Plain markdown on disk</span>
							<span class="hint">
								Every note is a .md file under VAULT_DIR. The sqlite cache can be deleted and
								rebuilt at any time.
							</span>
						</div>
					</div>
				</div>
			</section>

			<section>
				<h2>About</h2>
				<div class="rows">
					<div class="row">
						<div class="row-text">
							<span class="label">Scrinium</span>
							<span class="hint">Notes that stay plain files. SvelteKit 5 + CodeMirror 6 live preview.</span>
						</div>
					</div>
					<div class="row">
						<div class="row-text">
							<span class="label">Shortcuts</span>
							<span class="hint">
								<kbd>Ctrl/Cmd K</kbd> palette · <kbd>Ctrl/Cmd F</kbd> find · <kbd>Esc</kbd> full
								preview · <kbd>Ctrl/Cmd B</kbd> bold
							</span>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	/* The app layout sets html/body overflow:hidden, so this page owns its own
	   scroll region: fixed 48px bar on top, content scrolls below it. */
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--background);
		color: var(--on-surface);
		font-family: var(--font-ui);
	}
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
	.left {
		display: flex;
		align-items: center;
		gap: var(--stack-gap);
		min-width: 0;
	}
	.title {
		font-size: var(--font-editor-title-size);
		line-height: var(--font-editor-title-lh);
		font-weight: var(--font-editor-title-weight);
		letter-spacing: var(--font-editor-title-tracking);
		color: var(--on-surface);
	}
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--on-surface-variant);
		cursor: pointer;
		line-height: 1;
		flex-shrink: 0;
	}
	.icon-btn:hover:not(:disabled) {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.content {
		max-width: var(--editor-max-width);
		margin: 0 auto;
		padding: 20px var(--gutter) 48px;
	}
	section {
		margin-bottom: 28px;
	}
	h2 {
		margin: 0 0 2px;
		font-size: var(--font-label-caps);
		line-height: var(--font-label-caps-lh);
		font-weight: var(--font-label-caps-weight);
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--outline);
	}
	h3 {
		margin: 18px 0 2px;
		font-size: var(--font-ui-small);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
	}
	.section-hint {
		margin: 0 0 6px;
		font-size: var(--font-ui-micro);
		color: var(--outline);
	}
	.rows {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 0;
		border-top: 1px solid var(--border-default);
	}
	.row.toggle-row {
		cursor: pointer;
		user-select: none;
	}
	.row-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.row-text.grow {
		flex: 1;
	}
	.label {
		font-size: var(--font-ui-medium);
		font-weight: var(--font-ui-medium-weight);
		color: var(--on-surface);
	}
	.value {
		font-size: var(--font-ui-small);
		color: var(--on-surface-variant);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.hint {
		font-size: var(--font-ui-small);
		color: var(--outline);
		line-height: 1.5;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}
	.stepper input[type='range'] {
		width: 140px;
		accent-color: var(--primary);
	}
	input[type='checkbox'],
	input[type='radio'] {
		display: none;
	}
	.switch {
		width: 32px;
		height: 18px;
		border-radius: var(--radius-full);
		background: var(--surface-container-highest);
		position: relative;
		flex-shrink: 0;
		transition: background 0.15s ease;
	}
	.switch::after {
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
	input:checked + .switch {
		background: var(--primary);
	}
	input:checked + .switch::after {
		transform: translateX(14px);
		background: var(--on-primary);
	}
	.radio-row {
		cursor: pointer;
		user-select: none;
	}
	.radio-ui {
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--outline-variant);
		flex-shrink: 0;
		position: relative;
		margin-top: 2px;
		transition: border-color 0.15s ease;
	}
	.radio-ui::after {
		content: '';
		position: absolute;
		inset: 3px;
		border-radius: 50%;
		background: var(--primary);
		transform: scale(0);
		transition: transform 0.15s ease;
	}
	input:checked + .radio-ui {
		border-color: var(--primary);
	}
	input:checked + .radio-ui::after {
		transform: scale(1);
	}
	.row-text.grow {
		flex: 1;
	}
	.text-input {
		height: 28px;
		padding: 0 8px;
		background: var(--background);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface);
		font-size: var(--font-ui-small);
		outline: none;
		width: 180px;
		flex-shrink: 0;
	}
	.text-input:focus {
		border-color: var(--primary);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 10px;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
		color: var(--on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--font-ui-small);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-container-low);
		color: var(--on-surface);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.danger {
		color: var(--error);
		border-color: var(--border-default);
	}
	.btn.danger:hover:not(:disabled) {
		background: var(--error-container);
		color: var(--on-error-container);
	}
	.btn-group {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	code.hash {
		font-family: var(--font-mono);
		font-size: var(--font-ui-micro);
		color: var(--on-surface);
		background: var(--surface-container-high);
		padding: 2px 6px;
		border-radius: 4px;
		align-self: flex-start;
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-width: 56px;
	}
	.stat-value {
		font-size: 20px;
		font-weight: 600;
		color: var(--on-surface);
		line-height: 1;
	}
	.stat-label {
		font-size: var(--font-label-caps);
		font-weight: var(--font-label-caps-weight);
		letter-spacing: var(--label-caps-spacing);
		text-transform: uppercase;
		color: var(--outline);
	}
	kbd {
		font-family: var(--font-mono);
		font-size: var(--font-ui-micro);
		background: var(--surface-container-high);
		border-radius: 4px;
		padding: 1px 5px;
	}
</style>
