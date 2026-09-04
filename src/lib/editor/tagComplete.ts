/**
 * `#tag` completion source. Offers vault tags after `#`, filtered by what
 * is typed. Applying a tag completes the name and adds a trailing space so
 * typing continues cleanly. Tag list rides tagCtxField, same channel as
 * the pill decorations.
 */

import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { tagCtxField } from './livePreview';

const TRIGGER = /(?:^|[\s([{'"“‘>])#([A-Za-z0-9/_-]*)$/;

export function tagCompletionSource(context: CompletionContext): CompletionResult | null {
	const { state, pos } = context;
	const line = state.doc.lineAt(pos);
	const before = line.text.slice(0, pos - line.from);
	const trigger = TRIGGER.exec(before);
	if (!trigger) return null;
	const tags = state.field(tagCtxField, false) ?? [];
	if (!tags.length) return null;
	const typed = trigger[1].toLowerCase();
	const from = pos - trigger[1].length;

	return {
		from,
		options: tags
			.filter((t) => t.toLowerCase().startsWith(typed) && t.toLowerCase() !== typed)
			.slice(0, 30)
			.map((t) => ({
				label: `#${t}`,
				apply: (view: EditorView, _c: unknown, afrom: number, ato: number) => {
					view.dispatch({
						changes: { from: afrom, to: ato, insert: `${t} ` },
						selection: { anchor: afrom + t.length + 1 }
					});
				}
			})),
		validFor: /^[A-Za-z0-9/_-]*$/
	};
}
