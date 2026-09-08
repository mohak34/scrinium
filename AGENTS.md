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
5. **Breaking the title ↔ filename sync loop.** For `.md` notes the first `# `
   heading and the filename are kept identical (see `scheduleTitleSync` /
   `syncFilenameToTitle` in `src/lib/stores/vault.ts`). Both directions guard
   against loops by comparing sanitized values before acting; a rename also
   flushes pending saves first. Don't add a second path that renames notes
   without going through `renameNote`, or tabs/pins/activePath drift.
6. **Bypassing the trash index.** Deletes move files into `VAULT_DIR/.trash/`
   and record the original path in `.trash/index.json`. If you touch trash
   internals, keep that file in sync or restore falls back to guessing from
   the timestamp-prefixed name.
7. **Vertical margins on block widgets.** CodeMirror measures block widgets
   without their margins, so `margin: X 0` on `.cm-math-block` / `.cm-image`
   desyncs the height map — gutter numbers, cursor coords and arrow targets
   all shift below the widget, compounding per block. Put spacing in padding.

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
  markdownSetup.ts (CM6 language + theme + code/math highlight themes),
  callouts.ts (shared Obsidian `> [!note]` parser: kinds, aliases, icons,
  `findCallouts`; editor boxes via line decos + `!active` hides, print
  rewrites blockquotes post-restore so math/code inside keep rendering),
  wikilinks.ts (shared `[[link]]` parse/resolve/backlink-match; editor pill
  widgets + click-to-open/create via `wikiCtxField`, `[[` completion in
  wikiComplete.ts),
  frontmatter.ts (shared YAML `---` props: parse, `effectiveTitle`
  fm-title > body-heading > filename, `setEffectiveTitle` same-source
  rewrite, `frontmatterTags`, `updateFrontmatterBlock`; imported by the
  server title indexing too - title sync/indexer must never read line 1
  raw or a propertied note titles itself `---`),
  tags.ts (shared `#tag` parse skipping fm/fences/`[[...]]`; `#`
  completion in tagComplete.ts, census in `/api/tags`),
  CodeEditor.svelte (editor view; editor settings are reconfigurable via
  CodeMirror `Compartment`s; Tab indents via `indentWithTab`; math blocks
  reveal source when the cursor is on an adjacent line so arrows never
  have to cross hidden lines; vim motions via `@replit/codemirror-vim` in
  a `Compartment` gated by `settings.editor.vimMotions` - insert-mode
  helpers bail out in normal mode via `inVimNormal`, editor Esc drops to
  normal mode, normal-mode Esc enters preview, and app-level Esc exits
  preview via `exitPreview` so keyboard flow never strands on the mouse),
  mathBlock.ts (display math as a StateField: ```math fences + own-line
  `$$`, block replaces; ranges shared via mathRanges.ts so inline `$`
  in `livePreview.ts` never overlaps a block replace),
  mathComplete.ts (`\command` completion source, math regions only),
  mathSnippets.ts (Tab word/subscript and Space fraction triggers),
  yankFlash.ts (mini.nvim-style yank flash: line deco from the vim
  "<N> lines yanked" status notice via the facade dialog signal; visual
  yanks reuse the stashed selection, `yy` covers N lines at the cursor),
  formatting.ts.
- `src/lib/server/` — vault.ts (filesystem, path-traversal-safe, plus trash
  move/list/restore/purge backed by `.trash/index.json`), db.ts (sqlite cache
  + api_tokens table), shares.ts (public share links: random id → live vault
  path, optional scrypt password hash; rename/delete follow the file),
  auth.ts (better-auth, Google, allowlist), indexer.ts,
  mobileAuth.ts (Google ID-token verification + API-token issue/verify).
- `src/lib/stores/` — client state: vault.ts (notes + debounced autosave +
  tabs + title↔filename sync + trash actions), filetree.ts, actions.ts,
  settings.ts (editor prefs persisted to localStorage).
- `src/lib/components/` — CommandPalette, ContextMenu, FileTree, SearchBox,
  Sidebar, TabBar.
- `src/routes/` — `/` (+page.svelte shell), `/login`, `/settings` (account +
  mobile tokens + editor prefs), `/trash` (grouped restore/purge page),
  api/{auth,notes,tree,search,assets,attachments,tokens,trash,backlinks}. Mobile-only
  endpoints: `POST /api/auth/mobile` (Google ID token → long-lived API token)
  and `GET /api/notes/manifest` (metadata-only delta sync listing). Sharing:
  authed `GET/POST /api/shares` + `DELETE /api/shares/[id]`, public
  `GET/POST /api/share/[id]` (+ `/assets/...` for images) and the `/s/[id]`
  viewer (ShareModal.svelte manages links from the tab bar).

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
  exists. Tokens never expire server-side — list and revoke them from the
  settings page via `GET/DELETE /api/tokens`.
- Auth gates a shared vault: today all allowlisted users see the same files.
  Per-user vaults are a feature to build, not a config switch.
- Public routes (`/s`, `/api/share`) are allowlisted in `hooks.server.ts`
  with segment-boundary matching — a naive `startsWith` would let
  `/api/share` publicize `/api/shares` and `/s` open `/settings`.

## Verification

- The gate is `bun run check` — keep it at 0 errors / 0 warnings before and
  after a change.
- Live-preview behavior can be exercised headless via CDP against a running
  dev server (port 9222): drive the editor, then assert the mark flips back to
  raw text on the active line.

## Deployment / production facts

- Live at `https://scrinium.mohak.dev` on the VPS reachable at
  `ubuntu@tunnel.mohak.dev` (92.5.11.107).
- Deploys run through GitHub Actions (`.github/workflows/deploy.yml`): every
  push to `main` typechecks, builds, rsyncs to `/opt/scrinium/app`, runs
  `npm install --omit=dev --legacy-peer-deps` (recompiles native
  `better-sqlite3`), runs the idempotent better-auth migrate, restarts
  `scrinium.service`, and smoke-tests the site. Secrets used:
  `DEPLOY_KEY`, `VPS_HOST`, `VPS_USER`, `SITE_URL`.
- The rsync excludes `node_modules .git .svelte-kit data vault .opencode
  .env*` — notes and secrets are never shipped.
- systemd unit `scrinium.service` runs `node build/index.js` on
  `localhost:3000` (MemoryMax=500M); Caddy reverse-proxies + Let's Encrypt TLS.
- The `design/revamp` theme was merged into `main` (`d7bcb00`): added
  `src/lib/design/theme.css`, `@fontsource-variable/inter`,
  `@material-symbols/font-400`. `DESIGN.md` / `DESIGN_CODE.md` are gitignored
  reference docs for that theme.
- The vault and `data/` live OUTSIDE `app/` on the box and are never touched
  by deploys.
- Full background (VPS, Oracle Cloud firewall gotchas, Caddy, systemd,
  backups) in `DEPLOY.md`.

## Shipping a change

1. **Make and verify the change locally.** Edit and run `bun run check`
   (0 errors / 0 warnings); for editor work confirm the behavior in the dev
   server.
2. **Keep the docs honest.** If the change touches the editor, auth, or
   deployment, update this file (`Where code lives`, gotchas) and the README
   if it is user-facing, and `DEPLOY.md` if it changed ops. Docs ship in the
   same commit as the code — commit messages are short `fix:` / `feat:`.
3. **Commit + push to `main`.** That push IS the deploy — watch the Actions
   run, then hard-refresh `https://scrinium.mohak.dev` so the browser drops
   the old cached build.

**Manual fallback** (only if Actions is broken). From the repo root:

```bash
bun run build
tar -czf /tmp/scrinium-src.tgz \
  --exclude node_modules --exclude .git --exclude .svelte-kit \
  --exclude data --exclude vault --exclude .env --exclude .opencode .
scp /tmp/scrinium-src.tgz ubuntu@tunnel.mohak.dev:/tmp/
ssh ubuntu@tunnel.mohak.dev \
  'sudo bash -c "cd /opt/scrinium/app && tar -xzf /tmp/scrinium-src.tgz && \
   npm install --omit=dev --legacy-peer-deps && \
   chown -R scrinium:scrinium /opt/scrinium && systemctl restart scrinium"'
```

**Schema (auth/DB) changes:** CI runs the migrate on every deploy
(idempotent), so no extra step. To run it by hand:
```bash
sudo bash -c 'cd /opt/scrinium/app && set -a && . ./.env && set +a && npx @better-auth/cli migrate'
```

**Never** `rm -rf`, `chown`, or otherwise touch `vault/` and `data/` on the
VPS during a deploy — those hold the notes. Only `/opt/scrinium/app` is
overwritten.