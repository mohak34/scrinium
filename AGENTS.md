# Scrinium

Scrinium is a self-hosted, Obsidian-style notes app. SvelteKit 5 + CodeMirror 6
live-preview editor, notes stored as plain markdown files on disk, a sqlite
metadata cache, and a Google-OAuth-gated login. It is a lightweight, single-user
(allowlist multi-user) app that you deploy on your own box.

You can think of Scrinium as "notes that stay plain files." No lock-in, no
database as the source of truth, no service you can't reach into with a text
editor.

## What makes Scrinium special?

It is a small app on purpose. The entire live-preview engine lives in one file.
We guard the things that make it pleasant.

**1. Plain files are the source of truth.** Every note is a `.md` file in
`VAULT_DIR`. If you can read the filesystem you can read the notes. Backups,
search, and migration are all just file operations. Never build a feature on
the sqlite metadata cache as if it were authoritative.

**2. Live preview without the lock-in.** The editor is always plain markdown
under the hood. We render decorations on top of it — bigger headings, hidden
`**` marks, clickable checkboxes — and hide/reveal marks based on where the
cursor is. Move onto a line and the raw markdown reappears so you can edit it;
move away and it hides again. That is the whole trick, and it is the single
most important rule in this codebase (see "Ways to hurt yourself").

**3. Thin by default, expandable by design.** No graph view, no backlinks, no
plugin marketplace, no real-time collaboration. The architecture (plain files,
thin REST API, session auth) is set up to support future clients — desktop,
mobile, integrations — without a rewrite. It just does not ship them yet.

## A note from the maintainer

Build the smallest thing that makes the behavior unsurprising. Do not add
machinery because it looks architecturally impressive. `yagni` is a feature.
If a rule in this file fights the change you are making, say so loudly and get
a human sign-off before breaking it.

The rest of this file is meant to help you navigate the code and make changes
effectively. Treat it as good defaults, not hard laws — a human's explicit
instruction overrides anything here.

## A small glossary

- **you** means the agent reading this file.
- **we / the maintainer** means the person who runs Scrinium.
- **note** means one markdown document in the vault.
- **vault** means the root directory that holds all notes and attachments
  (`VAULT_DIR`; every server read/write resolves inside it).
- **live preview** means the editor showing decorations that style or hide raw
  markdown instead of a separate rendered pane.
- **mark** means a piece of markdown that renders to something prettier
  (a `#`, `**`, `[x]`, a bullet) and can be hidden.
- **decoration** means a CodeMirror `Decoration` (mark, replace, or widget)
  produced by `livePreview.ts`.
- **preview mode** means the full-preview state where every line renders with
  its marks hidden regardless of the cursor. Entered with Escape, exited by
  clicking in the editor.
- **the VPS** means the production box running the app (see Deployment).

## Ways to hurt yourself

Scrinium is small, but there are a few footguns specific to it.

1. **Dropping the `!active` guard.** Hideable marks (and the task checkbox
   widget) are gated with `!active` — only hidden when the cursor is off the
   line. Remove that guard and the caret can no longer travel across the raw
   mark (seen once, the task-checkbox bug, commit `dd206ec`). Every new
   hideable element keeps the guard, or it is a regression.
2. **Treating the SQLite table as authoritative.** It is a metadata cache.
   If it drifts, delete `data/scrinium.db` and re-run the migrate — the vault
   `.md` files are untouched. Never let a feature depend on the cache being
   present or correct.
3. **Committing secrets.** `.env` is gitignored for a reason. `ALLOWED_EMAILS`
   plus `BETTER_AUTH_SECRET` gate the whole deployment. Never log or commit
   them.
4. **Scope growth on the editor node walk.** The live-preview list is
   deliberately a curated subset (headings, bold/italic, inline code, links,
   checklists). Tables, nested lists, block quotes intentionally render as
   plain text. Do not sneak new cases into `livePreview.ts` without keeping
   the file small on purpose.

## Commands

Use `bun` (never npm/yarn) for dev tooling. The lockfile is `bun.lock`.

- `bun run dev` — dev server on `http://localhost:5173`. Bounces to `/login`.
- `bun run check` — the gate: `svelte-kit sync && svelte-check`. Must be
  0 errors / 0 warnings before committing.
- `bun run build` — production build via `@sveltejs/adapter-node` → `build/`,
  run with `node build/index.js`.
- `bun run preview` — preview the production build locally.
- `bun install` — install / sync dependencies.

## The live-preview editor — how it works

`src/lib/editor/livePreview.ts` is the heart of the project. The document is
always plain markdown. On every edit or cursor move it re-walks the Lezer
syntax tree and, node by node, decides whether to:

- **style in place** (`Decoration.mark`) — e.g. bigger heading text,
- **hide it** (`Decoration.replace`) — e.g. the `**` around bold,
- **swap for a widget** (`Decoration.widget`) — e.g. a clickable checkbox.

Core rule (Obsidian's): a mark is only hidden "unless the cursor is on that
line". Marks use an `active` / `isLineActive` check; hidden elements are gated
with `!active`. Preview mode (`previewOn`, entered with Escape) renders all
lines with marks hidden regardless of the cursor.

Task checkboxes: `TaskMarker` → `CheckboxWidget`. The checkbox replacement
must be `!active`-gated too — when the cursor is on a task line the raw
`[ ]` / `[x]` stays editable so the caret can cross the bracket (commit
`dd206ec`). Extend `HIDEABLE_MARKS` / add Lezer node-name cases to cover more
markdown.

State channels you will touch:
- `previewModeEffect` / `previewOn` (Enter preview = Escape; click to exit)
- `noteDirEffect` / `noteDirField` — the note's folder for resolving relative
  image URLs so the decoration set rebuilds when the note changes.

## Where code lives

- `src/lib/editor/` — live preview (`livePreview.ts`, read this first),
  markdownSetup.ts (CM6 language + theme), CodeEditor.svelte (editor view),
  formatting.ts.
- `src/lib/server/` — vault.ts (filesystem, path-traversal-safe), db.ts
  (sqlite cache + api_tokens table), auth.ts (better-auth, Google,
  allowlist), indexer.ts, mobileAuth.ts (Google ID-token verification +
  API-token issue/verify).
- `src/lib/stores/` — client state: vault.ts (notes + debounced autosave +
  tabs), filetree.ts, actions.ts.
- `src/lib/components/` — CommandPalette, ContextMenu, FileTree, SearchBox,
  Sidebar, TabBar, TopBar. TabBar was added in `2d69952` (open notes in tabs).
- `src/routes/` — +page.svelte (shell), login, api/{auth,notes,tree,search,
  assets,attachments}. Mobile-only endpoints: `POST /api/auth/mobile`
  (Google ID token → long-lived API token) and `GET /api/notes/manifest`
  (metadata-only delta sync listing).

## Auth & access

- `ALLOWED_EMAILS` in `.env` is the actual allowlist. Google's consent screen
  only proves who is who; `isAllowedEmail` in `src/lib/server/auth.ts`
  (used by both `databaseHooks.user.create` and `/api/auth/mobile`) rejects
  everyone not listed. Do not remove it.
- **Mobile API tokens**: `POST /api/auth/mobile` verifies a Google ID token
  (audience = `GOOGLE_CLIENT_ID`; the Android app requests its token with
  that ID as `serverClientId`, so no separate Android credential exists) and
  issues a random 256-bit token. Only its SHA-256 hash is stored in the
  `api_tokens` table. API requests send `Authorization: Bearer <token>`;
  `hooks.server.ts` falls back to the token lookup when no cookie session
  exists. Tokens never expire server-side — revoke by deleting the row
  (or keep `revokeBearerToken` for an endpoint later).
- Auth gates a shared vault: today all allowlisted users see the same files.
  Per-user vaults are a feature to build, not a config switch.

## Verification

- The gate is `bun run check` — keep it at 0 errors / 0 warnings before and
  after a change.
- Live-preview behavior can be exercised headless via CDP against a running
  dev server (port 9222): drive the editor, then assert the mark flips back to
  raw text on the active line.

## Deployment / production facts

- Live at `https://scrinium.mohak.dev` on the VPS reachable at
  `ubuntu@tunnel.mohak.dev` (92.5.11.107).
- systemd unit `scrinium.service` runs `node build/index.js` on
  `localhost:3000` (MemoryMax=500M); Caddy reverse-proxies + Let's Encrypt TLS.
- The `design/revamp` theme was merged into `main` (`d7bcb00`): added
  `src/lib/design/theme.css`, `@fontsource-variable/inter`,
  `@material-symbols/font-400`. `DESIGN.md` / `DESIGN_CODE.md` are gitignored
  reference docs for that theme.
- The vault and `data/` live OUTSIDE `app/` on the box and are never shipped
  or touched by deploys.
- Full background (VPS, Oracle Cloud firewall gotchas, Caddy, systemd, backups)
  in `DEPLOY.md`.

## Shipping a change & deploying to the VPS

Source lives in git; the VPS is a consumer, not a deploy from. There is no CI —
you ship a tarball by hand. The flow, in order:

1. **Make and verify the change locally.** Edit, run `bun run check`
   (0 errors / 0 warnings), and for editor work confirm the behavior in the
   dev server.
2. **Keep the docs honest.** If the change touches the editor, auth, or
   deployment, update this file (`Where code lives`, marks, gotchas) and the
   README if it is user-facing, and `DEPLOY.md` if it changed ops. Docs ship
   in the same commit as the code — commit messages are short `fix:` / `feat:`.
3. **Commit + push to git** (main) to the GitHub remote (`origin`). The repo is
   the single source of truth; push before you touch the box.
4. **Build the release** locally — the tarball must carry the compiled output:
   ```bash
   bun run build
   tar -czf /tmp/scrinium-src.tgz \
     --exclude node_modules --exclude .git --exclude .svelte-kit \
     --exclude data --exclude .env --exclude .opencode .
   scp /tmp/scrinium-src.tgz ubuntu@tunnel.mohak.dev:/tmp/
   ```
5. **Install on the VPS** (SSH in; most steps need `sudo` because `/opt` is
   root-owned). Unpack over the current app, re-install deps (run this every
   time — cheap, and it is what recompiles native `better-sqlite3`; the
   `--legacy-peer-deps` is kept as insurance against future transitive peer
   mismatches), fix ownership, and restart:
   ```bash
   sudo bash -c \
     'cd /opt/scrinium/app && tar -xzf /tmp/scrinium-src.tgz && \
      npm install --omit=dev --legacy-peer-deps && chown -R scrinium:scrinium /opt/scrinium'
   sudo systemctl restart scrinium
   sleep 2
   systemctl status scrinium --no-pager   # expect active (running)
   ```
6. **Verify.** `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
   (expect 302 → /login), then load `https://scrinium.mohak.dev` and hard
   refresh so the browser drops the old cached build.

**Schema (auth/DB) changes:** the sqlite DB already exists on the VPS. If you
changed better-auth config or added tables, run the migrate once more
(idempotent) before restarting:
```bash
sudo bash -c 'cd /opt/scrinium/app && set -a && . ./.env && set +a && npx @better-auth/cli migrate'
```

**Never** `rm -rf`, `chown`, or otherwise touch `vault/` and `data/` on the VPS
during a deploy — those hold the notes and are not in the tarball. Only
`/opt/scrinium/app` is overwritten.