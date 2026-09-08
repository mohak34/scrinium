import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

// Flash yanked lines briefly, mini.nvim-style. Vim's yank operator always
// posts a "<N> lines yanked" status notice; the notice opening (observed
// through the facade's "dialog" signal, see CodeEditor) is the only hook
// into a yank, since yanks change no document state to listen for.
//
// Effect payloads are 1-based line numbers, clamped to the doc at apply
// time so a concurrent edit can never throw the range out of bounds.
export const addYankFlash = StateEffect.define<{ from: number; to: number }>();
export const clearYankFlash = StateEffect.define<void>();

// Matches the vim confirmation text ("1 lines yanked", "3 lines yanked").
export const YANK_NOTICE = /(\d+) lines yanked/;

// Flash lifetime. Halved from 900ms: the mark should confirm, not linger.
export const YANK_FLASH_MS = 450;

export const yankFlashField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update: (set, tr) => {
		set = set.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(addYankFlash)) {
				const lines = tr.state.doc.lines;
				const from = Math.max(1, Math.min(e.value.from, lines));
				const to = Math.max(from, Math.min(e.value.to, lines));
				const build = new RangeSetBuilder<Decoration>();
				for (let n = from; n <= to; n++) {
					const line = tr.state.doc.line(n);
					build.add(line.from, line.from, Decoration.line({ class: 'cm-yank-flash' }));
				}
				set = build.finish();
			} else if (e.is(clearYankFlash)) {
				set = Decoration.none;
			}
		}
		return set;
	},
	provide: (f) => EditorView.decorations.from(f)
});

// Reuses the selection background: a yank flash reads as "marked", same as
// a visual selection, with no new theme color to keep in sync.
export const yankFlashTheme = EditorView.theme({
	'.cm-yank-flash': { backgroundColor: 'var(--selection-bg)' }
});
