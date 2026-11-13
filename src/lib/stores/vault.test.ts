import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

type Vault = typeof import('./vault.ts');
const A = 'Daily notes/A.md';
const B = 'Daily notes/B.md';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

function note(content: string, version = content) {
	return new Response(content, { headers: { 'X-Note-Version': JSON.stringify(version) } });
}

// Vite resolves the store's application imports without mounting a page or
// listening on a port. Each case gets its own autosave queue and note state.
async function setup(t: TestContext) {
	const server = await createServer({
		configFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, watch: null },
		resolve: { alias: { $lib: fileURLToPath(new URL('../', import.meta.url)) } }
	});
	t.after(() => server.close());
	const vault = await server.ssrLoadModule('/src/lib/stores/vault.ts') as Vault;
	const originalFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = originalFetch; });
	let text = '';
	let shows = 0;
	vault.attachEditor({
		show(_path, content) { text = content; shows++; return true; },
		read: () => text,
		write(content) { text = content; },
		replace(content) { text = content; },
		reveal() {}
	});
	globalThis.fetch = async () => note('server');
	async function open(path: string) {
		vault.openTab(path);
		await vault.showNote(path);
	}
	return { vault, open, text: () => text, shows: () => shows };
}

test('returning to a pending note paints before an unrelated refresh finishes', async (t) => {
	const { vault, open, text } = await setup(t);
	await open(B);
	const refresh = deferred<Response>();
	globalThis.fetch = (_input, options) => options?.method === 'PUT'
		? Promise.resolve(new Response(null, { status: 204 })) : refresh.promise.then(res => res.clone());
	const refreshing = vault.refreshShown();
	await Promise.resolve();
	vault.scheduleSave(A, 'unsaved A');
	vault.openTab(A);
	const switching = vault.showNote(A);
	const shown = vault.shownNote();
	refresh.resolve(note('server'));
	await Promise.all([refreshing, switching]);
	globalThis.fetch = async () => new Response(null, { status: 204 });
	await vault.flushSave();
	assert.equal(shown, A, 'the editor must not wait behind the refresh');
	assert.equal(text(), 'unsaved A');
});

test('returning to an in-flight save paints its latest text without draining saves', async (t) => {
	const { vault, open, text } = await setup(t);
	await open(B);
	const put = deferred<Response>();
	globalThis.fetch = (_input, options) => options?.method === 'PUT'
		? put.promise.then(res => res.clone()) : Promise.resolve(note('writing A'));
	vault.scheduleSave(A, 'writing A');
	vault.scheduleSave(B, 'pending B');
	const saving = vault.flushSave();
	await Promise.resolve();
	vault.openTab(A);
	const switching = vault.showNote(A);
	const shown = vault.shownNote();
	put.resolve(new Response(null, { status: 204 }));
	await Promise.all([saving, switching]);
	assert.equal(shown, A, 'the editor must not wait behind either PUT');
	assert.equal(text(), 'writing A');
});

test('a clean revisit paints immediately and revalidates without resetting the cursor', async (t) => {
	const { vault, open, text, shows } = await setup(t);
	globalThis.fetch = async (input) => note(String(input).endsWith('A.md') ? 'cached A' : 'cached B');
	await open(A);
	await open(B);
	const read = deferred<Response>();
	globalThis.fetch = () => read.promise.then(res => res.clone());
	vault.openTab(A);
	const switching = vault.showNote(A);
	const immediate = text();
	const shown = vault.shownNote();
	const count = shows();
	read.resolve(note('newer A'));
	await switching;
	assert.equal(immediate, 'cached A');
	assert.equal(shown, A);
	assert.equal(text(), 'newer A');
	assert.equal(shows(), count, 'revalidation must replace, not reopen the document');
});

test('typing during revalidation keeps both the text and its original save version', async (t) => {
	const { vault, open, text } = await setup(t);
	globalThis.fetch = async () => note('cached A', 'v1');
	await open(A);
	await open(B);
	const read = deferred<Response>();
	let matched: string | null = null;
	globalThis.fetch = async (_input, options) => {
		if (options?.method !== 'PUT') return read.promise.then(res => res.clone());
		matched = new Headers(options.headers).get('If-Match');
		return new Response(null, { status: 204 });
	};
	vault.openTab(A);
	const switching = vault.showNote(A);
	vault.scheduleSave(A, 'typed A');
	read.resolve(note('remote A', 'v2'));
	await switching;
	await vault.flushSave();
	assert.notEqual(text(), 'remote A');
	assert.equal(matched, '"v1"', 'an unseen remote version must still conflict');
});

test('an aborted read cannot win when a rapid switch returns to the same path', async (t) => {
	const { vault, text } = await setup(t);
	const first = deferred<Response>();
	const last = deferred<Response>();
	let calls = 0;
	globalThis.fetch = () => (++calls === 1 ? first.promise : last.promise);
	vault.openTab(A);
	const oldRead = vault.showNote(A);
	vault.openTab(B);
	vault.openTab(A);
	const newRead = vault.showNote(A);
	last.resolve(note('new A', 'v2'));
	await newRead;
	first.resolve(note('old A', 'v1'));
	await oldRead;
	assert.equal(text(), 'new A');
});

test('a slow background refresh never holds up autosave or replaces a completed save', async (t) => {
	const { vault, open, text } = await setup(t);
	await open(A);
	const read = deferred<Response>();
	let writes = 0;
	globalThis.fetch = async (_input, options) => {
		if (options?.method !== 'PUT') return read.promise;
		writes++;
		return new Response(null, { status: 204, headers: { 'X-Note-Version': '"saved"' } });
	};
	const refreshing = vault.refreshShown();
	await Promise.resolve();
	vault.scheduleSave(A, 'typed A');
	const saving = vault.flushSave();
	await Promise.resolve();
	const immediateWrites = writes;
	read.resolve(note('outdated remote A'));
	await Promise.all([refreshing, saving]);
	assert.equal(immediateWrites, 1, 'GET must not hold the save queue');
	assert.notEqual(text(), 'outdated remote A');
});

test('a failed save keeps newer typing available on a revisit and retries with its original version', async (t) => {
	const { vault, open, text } = await setup(t);
	await open(A);
	await open(B);
	const put = deferred<Response>();
	globalThis.fetch = () => put.promise;
	vault.scheduleSave(A, 'first A');
	const saving = vault.flushSave();
	await Promise.resolve();
	vault.scheduleSave(A, 'latest A');
	put.resolve(new Response(null, { status: 500 }));
	assert.equal(await saving, false);
	vault.openTab(A);
	await vault.showNote(A);
	assert.equal(text(), 'latest A');
	let matched: string | null = null;
	let sent: unknown;
	globalThis.fetch = async (_input, options) => {
		matched = new Headers(options?.headers).get('If-Match');
		sent = options?.body;
		return new Response(null, { status: 204, headers: { 'X-Note-Version': '"saved"' } });
	};
	assert.equal(await vault.flushSave(), true);
	assert.equal(matched, '"server"');
	assert.equal(sent, 'latest A');
});

test('a rename invalidates cached notes whose links it rewrites', async (t) => {
	const { vault, open, text } = await setup(t);
	globalThis.fetch = async () => note('[[A]]', 'before');
	await open(B);
	await open(A);
	globalThis.fetch = async (input, options) => {
		if (String(input) === '/api/tree') return Response.json([]);
		if (options?.method === 'PATCH') return Response.json({
			versions: { [B]: '"after"' }, previous: { [B]: '"before"' }
		});
		return note('[[C]]', 'after');
	};
	assert.equal(await vault.renameNote(A, 'Daily notes/C.md'), true);
	vault.openTab(B);
	const switching = vault.showNote(B);
	const immediate = vault.shownNote();
	await switching;
	assert.notEqual(immediate, B, 'a relinked snapshot must not paint');
	assert.equal(text(), '[[C]]');
});

test('a save redirected to a conflict copy caches the copy text and version, not the old path', async (t) => {
	const { vault, open, text } = await setup(t);
	const copy = 'Daily notes/A (conflict).md';
	globalThis.fetch = async () => note('# A\n\noriginal');
	await open(A);
	globalThis.fetch = async (input) => String(input) === '/api/tree' ? Response.json([]) : Response.json(
		{ path: copy, conflict: null }, { headers: { 'X-Note-Version': '"copy"' } }
	);
	vault.scheduleSave(A, '# A\n\nlatest');
	await vault.flushSave();
	assert.equal(vault.shownNote(), copy);
	globalThis.fetch = async () => note('B');
	await open(B);
	const read = deferred<Response>();
	globalThis.fetch = () => read.promise;
	vault.openTab(copy);
	const switching = vault.showNote(copy);
	const immediate = text();
	read.resolve(note('# A (conflict)\n\nlatest', 'copy'));
	await switching;
	assert.equal(immediate, '# A (conflict)\n\nlatest');
	let matched: string | null = null;
	globalThis.fetch = async (_input, options) => {
		matched = new Headers(options?.headers).get('If-Match');
		return new Response(null, { status: 204 });
	};
	vault.scheduleSave(copy, 'another edit');
	await vault.flushSave();
	assert.equal(matched, '"copy"');
});

test('revalidation and polling cannot apply an older response after a newer read', async (t) => {
	const { vault, open, text } = await setup(t);
	await open(A);
	const oldRefresh = deferred<Response>();
	const oldRead = deferred<Response>();
	const newRead = deferred<Response>();
	let calls = 0;
	globalThis.fetch = () => [oldRefresh.promise, oldRead.promise, newRead.promise][calls++];
	const refreshing = vault.refreshShown();
	vault.openTab(B);
	const leaving = vault.showNote(B);
	vault.openTab(A);
	const returning = vault.showNote(A);
	newRead.resolve(note('new A', 'v2'));
	await returning;
	oldRead.resolve(note('B'));
	oldRefresh.resolve(note('outdated A', 'v1'));
	await Promise.all([refreshing, leaving]);
	assert.equal(text(), 'new A');
});

test('a queued read retry cannot replace a newer background refresh', async (t) => {
	const { vault, open, text } = await setup(t);
	await open(A);
	await open(B);
	const first = deferred<Response>();
	const retry = deferred<Response>();
	const retryStarted = deferred<void>();
	let reads = 0;
	globalThis.fetch = async (input, options) => {
		if (String(input) === '/api/tree') return Response.json([]);
		if (options?.method === 'PATCH') return Response.json({});
		if (++reads === 1) return first.promise;
		if (reads === 2) {
			retryStarted.resolve();
			return retry.promise;
		}
		return note('new A', 'new');
	};
	vault.openTab(A);
	const switching = vault.showNote(A);
	await vault.renameNote(B, 'Daily notes/C.md');
	first.resolve(note('old A', 'old'));
	await retryStarted.promise;
	await vault.refreshShown();
	retry.resolve(note('old A', 'old'));
	await switching;
	assert.equal(text(), 'new A');
});
