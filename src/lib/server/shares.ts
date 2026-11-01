import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { db, under, underArgs } from './db';
import { listTree, readNote, safeResolve, vaultRel } from './vault';
import { renderNoteToHtml } from '$lib/print/renderNote';
import { resolveAssetUrl } from '$lib/attachments';
import { effectiveTitle } from '$lib/editor/frontmatter';
import { findWikilinksInText, notePathsFromTree, wikiResolver } from '$lib/editor/wikilinks';

// Public read-only share links. A share points at a live vault path - opening
// the link always renders the note's CURRENT content, not a snapshot. Files
// stay the source of truth; this table only maps a random public id to a
// path plus an optional password hash. Revoking is just deleting the row.
db.exec(`
	CREATE TABLE IF NOT EXISTS shares (
		id TEXT PRIMARY KEY,
		note_path TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		created_by TEXT,
		password_hash TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_shares_note_path ON shares(note_path);
`);
if (!(db.prepare(`PRAGMA table_info(shares)`).all() as { name: string }[]).some((c) => c.name === 'expires_at')) {
	db.exec(`ALTER TABLE shares ADD COLUMN expires_at INTEGER`);
}

// Older rows could hold a non-canonical path ("./a.md") that rename,
// archive and delete never matched by prefix. Rewrite them once.
for (const row of db.prepare(`SELECT id, note_path FROM shares`).all() as { id: string; note_path: string }[]) {
	try {
		const canonical = vaultRel(row.note_path);
		if (canonical !== row.note_path) {
			db.prepare(`UPDATE shares SET note_path = ? WHERE id = ?`).run(canonical, row.id);
		}
	} catch {
		// Outside the vault: the viewer already refuses it.
	}
}

export interface ShareRow {
	id: string;
	note_path: string;
	created_at: number;
	created_by: string | null;
	password_hash: string | null;
	expires_at: number | null;
}

export interface PublicShare {
	id: string;
	notePath: string;
	createdAt: number;
	hasPassword: boolean;
	expiresAt: number | null;
}

function toPublic(row: ShareRow): PublicShare {
	return {
		id: row.id,
		notePath: row.note_path,
		createdAt: row.created_at,
		hasPassword: !!row.password_hash,
		expiresAt: row.expires_at
	};
}

const expired = (row: ShareRow) => row.expires_at !== null && row.expires_at <= Date.now();

function newId(): string {
	// 12 url-safe chars, ~72 bits. Collision loop is cheap insurance.
	for (let i = 0; i < 5; i++) {
		const id = randomBytes(9).toString('base64url');
		if (!getShareRow(id)) return id;
	}
	throw new Error('Could not mint a share id');
}

// Passwords are never stored. scrypt with a per-share salt, encoded as
// `scrypt$<saltHex>$<hashHex>`. SHA-256 would be enough for tokens, but
// human passwords need a slow KDF.
export function hashSharePassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, 32);
	return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, len: number) => Promise<Buffer>;

// Wrong passwords per share: after 10 in 10 minutes the share answers 429
// until the window ends, so guessing stays slow and never ties up the
// server (the hash also runs off the main thread).
const FAIL_LIMIT = 10;
const FAIL_WINDOW = 10 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

export async function verifySharePassword(shareId: string, password: string, stored: string): Promise<boolean> {
	const now = Date.now();
	let f = failures.get(shareId);
	if (f && now - f.since > FAIL_WINDOW) f = undefined;
	if (f && f.count >= FAIL_LIMIT) throw error(429, 'Too many wrong passwords, try again later');
	// The guess counts before the hash runs, so a burst of parallel guesses
	// can't all slip in under the limit; a right one takes it back.
	if (!f) {
		if (failures.size > 1000) failures.clear();
		f = { count: 0, since: now };
		failures.set(shareId, f);
	}
	f.count++;
	const parts = stored.split('$');
	let ok = false;
	try {
		const salt = Buffer.from(parts[1] ?? '', 'hex');
		const expected = Buffer.from(parts[2] ?? '', 'hex');
		if (parts.length === 3 && parts[0] === 'scrypt' && salt.length === 16 && expected.length === 32)
			ok = timingSafeEqual(await scryptAsync(password, salt, 32), expected);
	} catch {}
	if (ok) f.count = Math.max(0, f.count - 1);
	return ok;
}

// Hash of the raw password for asset-URL comparison avoidance: asset URLs
// never carry the password itself. Instead the unlock response includes a
// short proof token derived per share id. Kept in memory only.
const proofCache = new Map<string, string>();

export function mintProofToken(shareId: string): string {
	const proof = randomBytes(16).toString('base64url');
	// Cap the cache so a long-lived process can't grow it without bound.
	// Evicting just means the viewer re-unlocks with the password it has.
	if (proofCache.size > 500) proofCache.clear();
	proofCache.set(`${shareId}:${proof}`, '1');
	return proof;
}

export function checkProofToken(shareId: string, proof: string | null): boolean {
	if (!proof) return false;
	return proofCache.has(`${shareId}:${proof}`);
}

export function createShare(
	notePath: string,
	createdBy: string | null,
	password?: string,
	expiresAt: number | null = null
): PublicShare {
	const row: ShareRow = {
		id: newId(),
		note_path: notePath,
		created_at: Date.now(),
		created_by: createdBy,
		password_hash: password ? hashSharePassword(password) : null,
		expires_at: expiresAt
	};
	db.prepare(
		`INSERT INTO shares (id, note_path, created_at, created_by, password_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
	).run(row.id, row.note_path, row.created_at, row.created_by, row.password_hash, row.expires_at);
	return toPublic(row);
}

function getShareRow(id: string): ShareRow | undefined {
	if (!id || id.length > 64) return undefined;
	return db.prepare(`SELECT * FROM shares WHERE id = ?`).get(id) as ShareRow | undefined;
}

export function getShare(id: string): PublicShare | undefined {
	const row = getShareRow(id);
	return row ? toPublic(row) : undefined;
}

/** Raw row for password checks - never serialize this to a client. An
 * expired link has none: it opens nothing, like a revoked one. */
export function getShareSecret(id: string): ShareRow | undefined {
	const row = getShareRow(id);
	return row && !expired(row) ? row : undefined;
}

export function listSharesForNote(notePath: string): PublicShare[] {
	const rows = db
		.prepare(`SELECT * FROM shares WHERE note_path = ? ORDER BY created_at DESC`)
		.all(notePath) as ShareRow[];
	return rows.map(toPublic);
}

// Every link in the vault, for Settings > Shared links.
export function listAllShares(): PublicShare[] {
	const rows = db.prepare(`SELECT * FROM shares ORDER BY note_path, created_at DESC`).all() as ShareRow[];
	return rows.map(toPublic);
}

// Set, change or (null) remove a link's password. Viewers unlocked with the
// old password lose their image proofs and have to unlock again.
export function setSharePassword(id: string, password: string | null) {
	db.prepare(`UPDATE shares SET password_hash = ? WHERE id = ?`).run(password ? hashSharePassword(password) : null, id);
	for (const key of proofCache.keys()) if (key.startsWith(`${id}:`)) proofCache.delete(key);
}

// Set or (null) clear when a link stops working.
export function setShareExpiry(id: string, expiresAt: number | null) {
	db.prepare(`UPDATE shares SET expires_at = ? WHERE id = ?`).run(expiresAt, id);
}

export function deleteShare(id: string): boolean {
	const res = db.prepare(`DELETE FROM shares WHERE id = ?`).run(id);
	return res.changes > 0;
}

// Called from the notes API so shares track the file, not a stale path.
export function renameShares(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT id, note_path FROM shares WHERE ${under('note_path')}`)
		.all(...underArgs(oldPath)) as { id: string; note_path: string }[];
	for (const row of rows) {
		const renamed = newPath + row.note_path.slice(oldPath.length);
		db.prepare(`UPDATE shares SET note_path = ? WHERE id = ?`).run(renamed, row.id);
	}
}

export function deleteSharesByPrefix(relPath: string) {
	db.prepare(`DELETE FROM shares WHERE ${under('note_path')}`).run(...underArgs(relPath));
}

// The local images a shared note shows, in render order: `urls` as written
// in the markdown (the viewer's lookup key), `paths` the vault files they
// resolve to against the note's real folder. The public asset route serves
// paths[i] and nothing else, so a share link never opens the rest of the
// vault, and the viewer never learns the note's folder.
export function shareImages(markdown: string, notePath: string): { urls: string[]; paths: string[] } {
	const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : null;
	const urls: string[] = [];
	const paths: string[] = [];
	renderNoteToHtml(markdown, notePath, (url) => {
		const resolved = resolveAssetUrl(url, dir);
		if (resolved?.startsWith('/api/assets/') && !urls.includes(url)) {
			urls.push(url);
			const file = resolved.slice('/api/assets/'.length).split(/[?#]/)[0];
			paths.push(file.split('/').map(decodeURIComponent).join('/'));
		}
		return null;
	});
	return { urls, paths };
}

// Every note with a live share link, for the archive's Review list.
export function sharedNotePaths(): Set<string> {
	const rows = db.prepare(`SELECT DISTINCT note_path FROM shares`).all() as { note_path: string }[];
	return new Set(rows.map((r) => r.note_path));
}

export interface SharePage {
	title: string;
	// One line of the note's text, for link previews in chat apps.
	description: string;
	html: string;
	// The note's sections, each heading carrying `id` in html.
	toc: { id: string; text: string; level: number }[];
	updatedAt: number | null;
	hasPassword: boolean;
}

// The note behind a link, rendered for the viewer: the note's current file,
// never a snapshot. Images load through this link's asset route (with a
// proof token for password links, never the password), and [[links]] to
// notes that have their own live link open that link. Throws 404 for an
// unknown or revoked link, 410 for an expired one or a deleted note, 401
// without the right password and 429 after too many wrong ones.
export async function openShare(id: string, password: string | null): Promise<SharePage> {
	const row = getShareRow(id);
	if (!row) throw error(404, 'This link is invalid or was revoked.');
	if (expired(row)) throw error(410, 'This link expired.');
	if (row.password_hash && (!password || !(await verifySharePassword(id, password, row.password_hash)))) {
		throw error(401, 'Password required');
	}
	let markdown: string;
	try {
		markdown = await readNote(row.note_path);
	} catch {
		throw error(410, 'This note no longer exists.');
	}
	let updatedAt: number | null = null;
	try {
		updatedAt = (await stat(safeResolve(row.note_path))).mtimeMs;
	} catch {}

	const { urls } = shareImages(markdown, row.note_path);
	const proof = row.password_hash ? `?proof=${encodeURIComponent(mintProofToken(id))}` : '';
	const asset = (url: string) => {
		const i = urls.indexOf(url);
		return i < 0 ? '' : `/api/share/${encodeURIComponent(id)}/assets/${i}${proof}`;
	};
	let linkTo: ((target: string) => string | null) | undefined;
	if (findWikilinksInText(markdown).some((w) => w.target)) {
		const notes = wikiResolver(notePathsFromTree(await listTree('')));
		const shareOf = db.prepare(
			`SELECT id FROM shares WHERE note_path = ? AND (expires_at IS NULL OR expires_at > ?)
			 ORDER BY password_hash IS NOT NULL, created_at DESC LIMIT 1`
		);
		linkTo = (target) => {
			const path = notes.resolve(target);
			const other = path && (shareOf.get(path, Date.now()) as { id: string } | undefined);
			return other ? `/s/${encodeURIComponent(other.id)}` : null;
		};
	}
	const title = effectiveTitle(markdown, row.note_path);
	const { html, toc } = withHeadingIds(renderNoteToHtml(markdown, row.note_path, asset, linkTo));
	return {
		title,
		description: excerpt(html, title),
		html,
		toc,
		updatedAt,
		hasPassword: !!row.password_hash
	};
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const INLINE = new Set(['a', 'span', 'strong', 'em', 'b', 'i', 'code', 's', 'del', 'mark', 'sub', 'sup', 'u']);
const VOID = new Set(['img', 'br', 'hr', 'input', 'wbr', 'col', 'source', 'path', 'rect', 'circle', 'line']);

// The text a reader sees in a piece of rendered html: no math, code or icons.
function plainText(html: string): string {
	let text = '';
	let skip = 0;
	let at = 0;
	for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g)) {
		const [, close, tag, attrs, selfClose] = m;
		if (!skip) text += html.slice(at, m.index) + (INLINE.has(tag.toLowerCase()) ? '' : ' ');
		at = m.index + m[0].length;
		if (VOID.has(tag.toLowerCase()) || selfClose) continue;
		if (close) {
			if (skip) skip--;
		} else if (skip || /^(pre|svg|style|script)$/i.test(tag) || /class="katex/.test(attrs)) skip++;
	}
	if (!skip) text += html.slice(at);
	return text
		.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e])
		.replace(/\s+/g, ' ')
		.trim();
}

function excerpt(html: string, title: string): string {
	let text = plainText(html.slice(0, 20_000));
	if (text.startsWith(title)) text = text.slice(title.length).trim();
	return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text;
}

// Gives every heading below the title an id the contents list can link to.
function withHeadingIds(html: string): Pick<SharePage, 'html' | 'toc'> {
	const toc: SharePage['toc'] = [];
	const used = new Set<string>();
	let first = true;
	const out = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (whole, lv: string, inner: string) => {
		const level = Number(lv);
		const text = plainText(inner);
		if ((first && level === 1) || !text) {
			first = false;
			return whole;
		}
		first = false;
		const base = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
		let id = base;
		for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
		used.add(id);
		toc.push({ id, text, level });
		return `<h${lv} id="${id}">${inner}</h${lv}>`;
	});
	return { html: out, toc };
}
