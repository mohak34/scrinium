/**
 * `[[wikilink]]` completion source. Offers vault note names after `[[`,
 * filtered by what is typed. Applying a note completes the closing
 * brackets and parks the cursor after them; applying free text (an
 * unresolved target) leaves the cursor inside so typing continues.
 * Note list rides wikiCtxField, same channel as the link decorations.
 */

import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { wikiCtxField } from './livePreview';
import { resolveWikilink } from './wikilinks';

const TRIGGER = /\[\[([^\][#|\n]*)$/;

export function wikiCompletionSource(context: CompletionContext): CompletionResult | null {
	const { state, pos } = context;
	const line = state.doc.lineAt(pos);
	const before = line.text.slice(0, pos - line.from);
	const trigger = TRIGGER.exec(before);
	if (!trigger) return null;
	const ctx = state.field(wikiCtxField, false);
	const notes = ctx?.notes ?? [];
	if (!notes.length) return null;
	const typed = trigger[1].toLowerCase();
	const from = pos - trigger[1].length;

	return {
		from,
		options: notes
			.filter((p) => {
				const stem = (p.split('/').pop() ?? p).replace(/\.md$/i, '');
				return stem.toLowerCase().includes(typed);
			})
			.slice(0, 30)
			.map((p) => {
				const stem = (p.split('/').pop() ?? p).replace(/\.md$/i, '');
				// When another note shares the name, the bare name would
				// resolve to that one: link by path instead.
				const target = resolveWikilink(stem, notes) === p ? stem : p.replace(/\.md$/i, '');
				return {
					label: stem,
					detail: p.includes('/') ? p : undefined,
					apply: (view: EditorView, _c: unknown, afrom: number, ato: number) => {
						view.dispatch({
							changes: { from: afrom, to: ato, insert: `${target}]]` },
							selection: { anchor: afrom + target.length + 2 }
						});
					}
				};
			}),
		validFor: /^[^\][#|\n]*$/
	};
}
