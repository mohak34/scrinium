/**
 * Frontmatter properties box as a StateField block replace.
 *
 * A leading `---` YAML block renders as a read-only key/value box while
 * the cursor is elsewhere; moving onto or next to it reveals the raw YAML
 * so it stays editable - the same adjacent-line contract as mathBlock.ts
 * (hidden lines near the cursor break arrow navigation). The file on disk
 * stays plain YAML either way.
 *
 * Must be a StateField (not the livePreview ViewPlugin): replacing whole
 * lines changes vertical layout. livePreview skips the block's ranges and
 * mathRanges excludes it, so no two layers claim the same lines.
 */

import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { previewModeEffect, isPreviewMode } from './livePreview';
import { parseFrontmatter, propDisplayRows } from './frontmatter';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class PropBlockWidget extends WidgetType {
	constructor(readonly raw: string) {
		super();
	}
	eq(other: PropBlockWidget) {
		return other.raw === this.raw;
	}
	get estimatedHeight(): number {
		return 16 + this.raw.split('\n').length * 24;
	}
	toDOM() {
		const fm = parseFrontmatter(this.raw);
		const div = document.createElement('div');
		div.className = 'cm-prop-block';
		if (!fm) return div;
		for (const row of propDisplayRows(fm.data)) {
			const r = document.createElement('div');
			r.className = 'cm-prop-row';
			const k = document.createElement('span');
			k.className = 'cm-prop-key';
			k.textContent = row.key;
			const v = document.createElement('span');
			v.className = 'cm-prop-value';
			v.textContent = row.display;
			r.append(k, v);
			div.append(r);
		}
		return div;
	}
}

function isRangeActive(state: EditorState, from: number, to: number): boolean {
	if (isPreviewMode()) return false;
	const cursorLine = state.doc.lineAt(state.selection.main.head).number;
	const startLine = state.doc.lineAt(from).number;
	const endLine = state.doc.lineAt(to).number;
	// Same one-line grace as math blocks: hidden lines near the cursor
	// break native Up/Down, so reveal when adjacent.
	return cursorLine >= startLine - 1 && cursorLine <= endLine + 1;
}

function buildPropDecorations(state: EditorState): DecorationSet {
	const fm = parseFrontmatter(state.doc.toString());
	if (!fm) return Decoration.none;
	const from = 0;
	const to = fm.bodyStart;
	if (isRangeActive(state, from, Math.max(from, to - 1))) return Decoration.none;
	return Decoration.set(
		[Decoration.replace({ widget: new PropBlockWidget(state.doc.sliceString(from, to)), block: true }).range(from, to)],
		true
	);
}

export const propBlockField = StateField.define<DecorationSet>({
	create: (state) => buildPropDecorations(state),
	update(deco, tr) {
		if (tr.docChanged || tr.reconfigured) {
			return buildPropDecorations(tr.state);
		}
		if (tr.effects.some((e) => e.is(previewModeEffect))) {
			return buildPropDecorations(tr.state);
		}
		if (tr.selection) {
			const before = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
			const after = tr.state.doc.lineAt(tr.state.selection.main.head).number;
			if (before !== after) return buildPropDecorations(tr.state);
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});
