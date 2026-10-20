import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { movedBy, noteLinks, relinkNote } from '../src/lib/relink';
import { findWikilinksInText, linkFirstMention, wikilinkNewPath, wikiResolver } from '../src/lib/editor/wikilinks';

const vault = ['Inbox.md', 'Uni/Lecture.md', 'Uni/Plan.md', 'Work/Plan.md', 'Plan.md', 'Recipes/Soup.md'];

function rename(content: string, notePath: string, from: string, to: string, paths = vault) {
	const moved = movedBy(from, to);
	const wiki = { before: wikiResolver(paths), after: wikiResolver(paths.map(moved)) };
	return relinkNote(content, notePath, moved(notePath), moved, wiki);
}

describe('wikilinks', () => {
	test('[[#heading]] links within the note', () => {
		const [w] = findWikilinksInText('see [[#Setup|setup]]');
		assert.equal(w.target, '');
		assert.equal(w.heading, 'Setup');
	});

	test('[[]] is not a link', () => {
		assert.deepEqual(findWikilinksInText('[[]] and [[ ]]'), []);
	});

	test('new notes land next to the note, or at the folder the link names', () => {
		assert.equal(wikilinkNewPath('Idea', 'Uni/Lecture.md'), 'Uni/Idea.md');
		assert.equal(wikilinkNewPath('Work/Idea', 'Uni/Lecture.md'), 'Work/Idea.md');
		assert.equal(wikilinkNewPath('../x', null), null);
	});

	test('mention conversion links by path when the bare name goes elsewhere', () => {
		const links = wikiResolver(vault);
		assert.equal(linkFirstMention('the plan is late', 'Work/Plan.md', links), 'the [[Work/Plan|plan]] is late');
		assert.equal(linkFirstMention('make soup', 'Recipes/Soup.md', links), 'make [[soup]]');
	});
});

describe('noteLinks', () => {
	test('both link kinds, never inside code', () => {
		const text = '[[Lecture]] [s](../Recipes/Soup.md)\n`[[Inbox]]`\n```\n[[Plan]]\n```\n[[#Top]]';
		const got = noteLinks(text, 'Uni/Plan.md', wikiResolver(vault)).map((l) => l.target);
		assert.deepEqual(got, ['Uni/Lecture.md', 'Recipes/Soup.md', 'Uni/Plan.md']);
	});
});

describe('relinkNote with wikilinks', () => {
	test('a renamed note keeps its links, heading and alias', () => {
		assert.equal(rename('[[Soup#Steps|how]]', 'Inbox.md', 'Recipes/Soup.md', 'Recipes/Broth.md'), '[[Broth#Steps|how]]');
	});

	test('a moved note with a unique name keeps the bare link', () => {
		assert.equal(rename('[[Soup]]', 'Inbox.md', 'Recipes/Soup.md', 'Archive/Soup.md'), '[[Soup]]');
	});

	test('a path link follows a folder rename', () => {
		assert.equal(rename('[[Work/Plan]]', 'Inbox.md', 'Work', 'Job'), '[[Job/Plan]]');
	});

	test('a move that takes over a bare name pins the old links by path', () => {
		// Plan.md at the root wins [[Plan]]; moving it deeper hands the name to Uni/Plan.md.
		assert.equal(rename('[[Plan]]', 'Inbox.md', 'Plan.md', 'Old/Deep/Plan.md'), '[[Old/Deep/Plan]]');
	});

	test('links in code and unrelated links are left as written', () => {
		const text = '`[[Soup]]` [[Lecture]] [[Missing]]';
		assert.equal(rename(text, 'Inbox.md', 'Recipes/Soup.md', 'Recipes/Broth.md'), text);
	});

	test('markdown links still follow a move', () => {
		assert.equal(rename('[s](Recipes/Soup.md#steps)', 'Inbox.md', 'Recipes', 'Food'), '[s](Food/Soup.md#steps)');
	});
});
