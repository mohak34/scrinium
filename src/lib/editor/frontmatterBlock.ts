/**
 * The note's YAML properties as a StateField: a key/value block widget
 * while the cursor is outside the `---` block (and always in preview
 * mode), the raw YAML in small dim mono while the cursor is inside it.
 * A StateField for the same reason as mathBlock.ts: replacing whole lines
 * changes layout, which a ViewPlugin may not do.
 */

import { StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { fmEnd } from './docRanges';
import { frontmatterTags, parseFrontmatter, propDisplayRows } from './frontmatter';
import { isPreviewMode, previewModeEffect } from './livePreview';

class PropsWidget extends WidgetType {
	constructor(readonly raw: string) {
		super();
	}
	eq(other: PropsWidget) {
		return other.raw === this.raw;
	}
	toDOM() {
		const box = document.createElement('div');
		box.className = 'cm-props';
		const data = parseFrontmatter(this.raw)?.data ?? {};
		for (const row of propDisplayRows(data)) {
			const key = box.appendChild(document.createElement('span'));
			key.className = 'cm-props-key';
			key.textContent = row.key;
			const val = box.appendChild(document.createElement('span'));
			val.className = 'cm-props-val';
			if (row.key === 'tags') {
				for (const t of frontmatterTags(data)) {
					const chip = val.appendChild(document.createElement('span'));
					chip.className = 'cm-tag';
					chip.append(Object.assign(document.createElement('span'), { className: 'cm-tag-hash', textContent: '#' }), t);
				}
			} else val.textContent = row.display;
		}
		return box;
	}
	// A click puts the cursor in the block, which reveals the YAML.
	ignoreEvent() {
		return false;
	}
}

// The block from line 1 through the closing fence, or null without one.
function fmBlock(state: EditorState): { to: number; raw: string } | null {
	const end = Math.min(fmEnd(state), state.doc.length);
	if (end === 0) return null;
	const to = state.doc.lineAt(Math.max(0, end - 1)).to;
	return { to, raw: state.doc.sliceString(0, to) };
}

function isActive(state: EditorState, to: number): boolean {
	return !isPreviewMode() && state.selection.main.head <= to;
}

function build(state: EditorState): DecorationSet {
	const block = fmBlock(state);
	if (!block) return Decoration.none;
	if (!isActive(state, block.to)) {
		return Decoration.set(Decoration.replace({ widget: new PropsWidget(block.raw), block: true }).range(0, block.to));
	}
	const lines = [];
	for (let n = 1; n <= state.doc.lineAt(block.to).number; n++)
		lines.push(Decoration.line({ class: 'cm-fm-line' }).range(state.doc.line(n).from));
	return Decoration.set(lines);
}

export const frontmatterField = StateField.define<DecorationSet>({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.reconfigured || tr.effects.some((e) => e.is(previewModeEffect))) return build(tr.state);
		if (tr.selection) {
			const block = fmBlock(tr.state);
			if (block && isActive(tr.startState, block.to) !== isActive(tr.state, block.to)) return build(tr.state);
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});
