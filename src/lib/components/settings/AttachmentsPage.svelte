<script lang="ts">
	import Select from '../Select.svelte';
	import { settings, attachmentDirFor, cleanFolder, type AttachmentBase } from '$lib/stores/settings';

	const BASES: { value: AttachmentBase; label: string }[] = [
		{ value: 'project', label: "The note's project" },
		{ value: 'vault', label: 'Vault root' },
		{ value: 'note', label: "The note's folder" }
	];

	const att = $derived($settings.attachments);
	// Worked examples so the setting reads as a path, not an abstraction.
	const EXAMPLE_PROJECTS = new Set(['Uni']);
	const examples = $derived(
		[
			{ lbl: 'In project Uni', note: 'Uni/DSA/Lecture 14.md' },
			{ lbl: 'Outside projects', note: 'Journal/Today.md' }
		].map((ex) => {
			const dir = attachmentDirFor(ex.note, att, EXAMPLE_PROJECTS);
			return { ...ex, dir: dir ? `${dir}/` : 'vault root' };
		})
	);

	function patch(p: Partial<typeof att>) {
		settings.update((s) => ({ ...s, attachments: { ...s.attachments, ...p } }));
	}
	function setFolder(input: HTMLInputElement) {
		const folder = cleanFolder(input.value);
		if (folder === null) input.value = att.folder;
		else patch({ folder });
	}
</script>

<div class="row">
	<div class="txt">
		<span class="lbl">Save pasted files in</span>
		<span class="hint">A note outside every project uses the vault root. New pastes only</span>
	</div>
	<Select boxed value={att.base} options={BASES} label="Save pasted files in" onchange={(base) => patch({ base })} />
</div>
<div class="row">
	<div class="txt"><span class="lbl">Folder</span><span class="hint">Inside that. Empty saves there directly</span></div>
	<input class="input" value={att.folder} placeholder="attachments" spellcheck="false" onchange={(e) => setFolder(e.currentTarget)} />
</div>
{#each examples as ex (ex.note)}
	<div class="row">
		<div class="txt">
			<span class="lbl">{ex.lbl}</span>
			<span class="hint">Pasting into <span class="mono">{ex.note}</span> saves to</span>
		</div>
		<span class="mono path">{ex.dir}</span>
	</div>
{/each}

<style>
	.path {
		font-size: 12px;
		color: var(--accent);
	}
</style>
