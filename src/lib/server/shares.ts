import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { renderNoteToHtml } from '$lib/print/renderNote';
import { resolveAssetUrl } from '$lib/editor/livePreview';

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

export interface ShareRow {
	id: string;
	note_path: string;
	created_at: number;
	created_by: string | null;
	password_hash: string | null;
}

export interface PublicShare {
	id: string;
	notePath: string;
	createdAt: number;
	hasPassword: boolean;
}

function toPublic(row: ShareRow): PublicShare {
	return {
		id: row.id,
		notePath: row.note_path,
		createdAt: row.created_at,
		hasPassword: !!row.password_hash
	};
}

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

export function verifySharePassword(password: string, stored: string): boolean {
	const parts = stored.split('$');
	if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
	try {
		const salt = Buffer.from(parts[1], 'hex');
		const expected = Buffer.from(parts[2], 'hex');
		if (salt.length !== 16 || expected.length !== 32) return false;
		const actual = scryptSync(password, salt, 32);
		return timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
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

export function createShare(notePath: string, createdBy: string | null, password?: string): PublicShare {
	const row: ShareRow = {
		id: newId(),
		note_path: notePath,
		created_at: Date.now(),
		created_by: createdBy,
		password_hash: password ? hashSharePassword(password) : null
	};
	db.prepare(
		`INSERT INTO shares (id, note_path, created_at, created_by, password_hash) VALUES (?, ?, ?, ?, ?)`
	).run(row.id, row.note_path, row.created_at, row.created_by, row.password_hash);
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

/** Raw row for password checks - never serialize this to a client. */
export function getShareSecret(id: string): ShareRow | undefined {
	return getShareRow(id);
}

export function listSharesForNote(notePath: string): PublicShare[] {
	const rows = db
		.prepare(`SELECT * FROM shares WHERE note_path = ? ORDER BY created_at DESC`)
		.all(notePath) as ShareRow[];
	return rows.map(toPublic);
}

export function deleteShare(id: string): boolean {
	const res = db.prepare(`DELETE FROM shares WHERE id = ?`).run(id);
	return res.changes > 0;
}

// Called from the notes API so shares track the file, not a stale path.
export function renameShares(oldPath: string, newPath: string) {
	const rows = db
		.prepare(`SELECT id, note_path FROM shares WHERE note_path = ? OR note_path LIKE ?`)
		.all(oldPath, `${oldPath}/%`) as { id: string; note_path: string }[];
	for (const row of rows) {
		const renamed = newPath + row.note_path.slice(oldPath.length);
		db.prepare(`UPDATE shares SET note_path = ? WHERE id = ?`).run(renamed, row.id);
	}
}

export function deleteSharesByPrefix(relPath: string) {
	db.prepare(`DELETE FROM shares WHERE note_path = ? OR note_path LIKE ?`).run(
		relPath,
		`${relPath}/%`
	);
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
			paths.push(resolved.slice('/api/assets/'.length).split('/').map(decodeURIComponent).join('/'));
		}
		return null;
	});
	return { urls, paths };
}
