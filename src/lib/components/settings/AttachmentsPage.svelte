<script lang="ts">
	import { settings, attachmentDirFor, DEFAULT_SETTINGS, type AttachmentLocation } from '$lib/stores/settings';

	const LOCATIONS: { value: AttachmentLocation; label: string }[] = [
		{ value: 'vault', label: 'Folder in vault root' },
		{ value: 'note', label: 'Next to the note' },
		{ value: 'subfolder', label: 'Subfolder next to the note' },
		{ value: 'root', label: 'Vault root' },
		{ value: 'custom', label: 'Custom path' }
	];

	const att = $derived($settings.attachments);
	// A worked example so the setting reads as a path, not an abstraction.
	const example = $derived(attachmentDirFor('College/DSA', att));

	function patch(p: Partial<typeof att>) {
		settings.update((s) => ({ ...s, attachments: { ...s.attachments, ...p } }));
	}
	const setName = (v: string) => patch({ name: v.trim() || DEFAULT_SETTINGS.attachments.name });
	const setFolder = (v: string) =>
		patch({ folder: v.split('/').map((p) => p.trim()).filter(Boolean).join('/') });
</script>

<div class="row">
	<div class="txt"><span class="lbl">Pasted images go to</span><span class="hint">New pastes only. Existing files stay put</span></div>
	<select class="input sel" value={att.location} onchange={(e) => patch({ location: e.currentTarget.value as AttachmentLocation })}>
		{#each LOCATIONS as l (l.value)}
			<option value={l.value}>{l.label}</option>
		{/each}
	</select>
</div>
{#if att.location === 'vault' || att.location === 'subfolder'}
	<div class="row">
		<div class="txt"><span class="lbl">Folder name</span><span class="hint">Default is "{DEFAULT_SETTINGS.attachments.name}"</span></div>
		<input class="input" value={att.name} spellcheck="false" onchange={(e) => setName(e.currentTarget.value)} />
	</div>
{:else if att.location === 'custom'}
	<div class="row">
		<div class="txt"><span class="lbl">Path</span><span class="hint">Relative to the vault</span></div>
		<input class="input" value={att.folder} placeholder="media/pasted" spellcheck="false" onchange={(e) => setFolder(e.currentTarget.value)} />
	</div>
{/if}
<div class="row">
	<div class="txt">
		<span class="lbl">Example</span>
		<span class="hint">Pasting into <span class="mono">College/DSA/Lecture 14.md</span> saves to</span>
	</div>
	<span class="mono path">{example ? `${example}/` : 'vault root'}</span>
</div>

<style>
	select.input.sel {
		font-family: var(--font-ui);
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.path {
		font-size: 12px;
		color: var(--accent);
	}
</style>
