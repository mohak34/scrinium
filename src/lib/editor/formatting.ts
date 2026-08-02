import type { Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// Wrap the selection (or, if collapsed, the cursor point) in `marker`, toggling
// it off when the surrounding characters are already the markers (so Cmd+B on a
// selection that sits inside **..** unwraps it). Returns true so it can be used
// directly as a CodeMirror keymap command.
export function toggleWrap(marker: string) {
	return (view: EditorView): boolean => {
		const { from, to } = view.state.selection.main;
		const ml = marker.length;
		const before = from - ml >= 0 ? view.state.sliceDoc(from - ml, from) : '';
		const after = view.state.sliceDoc(to, to + ml);
		if (before === marker && after === marker) {
			view.dispatch({
				changes: [
					{ from: from - ml, to: from, insert: '' },
					{ from: to, to: to + ml, insert: '' }
				],
				selection: { anchor: from - ml, head: to - ml }
			});
		} else {
			const text = view.state.sliceDoc(from, to);
			view.dispatch({
				changes: { from, to, insert: marker + text + marker },
				selection: { anchor: from + ml, head: to + ml }
			});
		}
		return true;
	};
}

// Prefix the current line with N hashes. Same level toggles the heading off.
export function setHeading(level: number) {
	return (view: EditorView): boolean => {
		const line = view.state.doc.lineAt(view.state.selection.main.head);
		const m = /^(#{0,6})[ \t]?/.exec(line.text)!;
		const had = m[1].length;
		const insert = had === level ? '' : '#'.repeat(level) + ' ';
		view.dispatch({
			changes: { from: line.from, to: line.from + m[0].length, insert },
			selection: { anchor: line.from + insert.length }
		});
		return true;
	};
}

// Every line the main selection touches, from the line under the anchor to the
// line under the head. Collapsed selections yield a single line.
function selectedLines(view: EditorView): Line[] {
	const { from, to } = view.state.selection.main;
	const start = view.state.doc.lineAt(from).number;
	const end = view.state.doc.lineAt(to).number;
	const lines: Line[] = [];
	for (let n = start; n <= end; n++) lines.push(view.state.doc.line(n));
	return lines;
}

// Toggle a task checkbox on the selected line(s): checks/unchecks an existing
// `- [ ]` / `- [x]`, upgrades a plain bullet to a checkbox, or inserts a fresh
// `- [ ]` when the line is empty. Keeps any leading indentation intact.
// When multiple lines are selected and all of them are already tasks, the whole
// block is checked/unchecked at once; otherwise every line is turned into a
// task (existing ones keep their check state).
export function toggleTask(view: EditorView): boolean {
	const lines = selectedLines(view);
	const taskRe = /^(\s*)- \[([ xX])\]\s?/;

	if (lines.length > 1 && lines.every((l) => taskRe.test(l.text))) {
		view.dispatch({
			changes: lines.map((l) => {
				const indent = l.text.match(/^\s*/)![0];
				return {
					from: l.from + indent.length + 2,
					to: l.from + indent.length + 5,
					insert: l.text[indent.length + 3] === ' ' ? '[x]' : '[ ]'
				};
			})
		});
		return true;
	}

		if (lines.length === 1 && taskRe.test(lines[0].text)) {
			const l = lines[0];
			const indent = l.text.match(/^\s*/)![0];
			view.dispatch({
				changes: {
					from: l.from + indent.length + 2,
					to: l.from + indent.length + 5,
					insert: l.text[indent.length + 3] === ' ' ? '[x]' : '[ ]'
				}
			});
			return true;
		}

		const changes = lines
			.map((l) => {
				if (taskRe.test(l.text)) return null;
				const indent = l.text.match(/^\s*/)![0];
				const bullet = /^(\s*)- /.exec(l.text);
				if (bullet) {
					return { from: l.from, to: l.from + bullet[0].length, insert: `${bullet[1]}- [ ] ` };
				}
				return { from: l.from + indent.length, to: l.from + indent.length, insert: '- [ ] ' };
			})
			.filter((c): c is NonNullable<typeof c> => c !== null);
		view.dispatch({ changes });
	return true;
}

// Toggle "- " bullets on the selected line(s). If every selected line is
// already a bullet, they are all removed; otherwise bullets are added to the
// lines that lack one. Leading indentation is preserved either way.
export function toggleBullet(view: EditorView): boolean {
	const lines = selectedLines(view);
	const bulletRe = /^(\s*)[-*+]\s/;
	const hasBullet = (l: Line) => bulletRe.test(l.text);

	if (lines.every(hasBullet)) {
		view.dispatch({
			changes: lines.map((l) => {
				const indent = l.text.match(/^\s*/)![0];
				return {
					from: l.from + indent.length,
					to: l.from + indent.length + bulletRe.exec(l.text)![0].length - indent.length,
					insert: ''
				};
			})
		});
		return true;
	}

	view.dispatch({
		changes: lines
			.filter((l) => !hasBullet(l))
			.map((l) => {
				const indent = l.text.match(/^\s*/)![0];
				return { from: l.from + indent.length, to: l.from + indent.length, insert: '- ' };
			})
	});
	return true;
}
