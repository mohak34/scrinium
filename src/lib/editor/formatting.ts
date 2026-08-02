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

// Toggle a task checkbox on the current line: checks/unchecks an existing
// `- [ ]` / `- [x]`, upgrades a plain bullet to a checkbox, or inserts a fresh
// `- [ ]` when the line is empty. Keeps any leading indentation intact.
export function toggleTask(view: EditorView): boolean {
	const line = view.state.doc.lineAt(view.state.selection.main.head);
	const task = /^(\s*)- \[([ xX])\]\s?/.exec(line.text);
	if (task) {
		const marker = task[2] === ' ' ? '[x]' : '[ ]';
		view.dispatch({
			changes: {
				from: line.from + task[1].length + 2,
				to: line.from + task[1].length + 5,
				insert: marker
			}
		});
		return true;
	}
	const bullet = /^(\s*)- /.exec(line.text);
	if (bullet) {
		view.dispatch({
			changes: {
				from: line.from,
				to: line.from + bullet[0].length,
				insert: `${bullet[1]}- [ ] `
			}
		});
		return true;
	}
	view.dispatch({
		changes: { from: line.from, to: line.from, insert: '- [ ] ' }
	});
	return true;
}

// Toggle a "- " bullet on the current line.
export function toggleBullet(view: EditorView): boolean {
	const line = view.state.doc.lineAt(view.state.selection.main.head);
	const m = /^(\s*)[-*+]\s/.exec(line.text);
	if (m) {
		view.dispatch({
			changes: { from: line.from, to: line.from + m[0].length, insert: '' }
		});
	} else {
		view.dispatch({
			changes: { from: line.from, to: line.from, insert: '- ' }
		});
	}
	return true;
}
