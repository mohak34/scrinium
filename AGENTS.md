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

Use `bun` (never npm/yarn). The lockfile is `bun.lock`.

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
  (sqlite cache), auth.ts (better-auth, Google, allowlist), indexer.ts.
- `src/lib/stores/` — client state: vault.ts (notes + debounced autosave +
  tabs), filetree.ts, actions.ts.
- `src/lib/components/` — CommandPalette, ContextMenu, FileTree, SearchBox,
  Sidebar, TabBar, TopBar. TabBar was added in `2d69952` (open notes in tabs).
- `src/routes/` — +page.svelte (shell), login, api/{auth,notes,tree,search,
  assets,attachments}.

## Auth & access

- `ALLOWED_EMAILS` in `.env` is the actual allowlist. Google's consent screen
  only proves who is who; `databaseHooks.user.create` in
  `src/lib/server/auth.ts` rejects everyone not listed. Do not remove it.
- Auth gates a shared vault: today all allowlisted users see the same files.
  Per-user vaults are a feature to build, not a config switch.

## Verification

- The gate is `bun run check` — keep it at 0 errors / 0 warnings before and
  after a change.
- Live-preview behavior can be exercised headless via CDP against a running
  dev server (port 9222): drive the editor, then assert the mark flips back to
  raw text on the active line.

## Taste

- Small on purpose. If a change adds a whole abstraction when an `if` would
  do, it is not "architecturally interesting" — it is noise.
- Plain files first. If a feature can run off the filesystem, prefer that over
  a database query.
- Keep the live preview curated. Fewer cases, kept clean, beats a complete
  list nobody can maintain.

## Deployment / production facts

- Live at `https://scrinium.mohak.dev` on the VPS reachable at
  `ubuntu@tunnel.mohak.dev`
- systemd unit `scrinium.service` runs `node build/index.js` on
  `localhost:3000` (MemoryMax=500M); Caddy reverse-proxies + Let's Encrypt TLS.
- The `design/revamp` theme was merged into `main` (`d7bcb00`): added
  `src/lib/design/theme.css`, `@fontsource-variable/inter`,
  `@material-symbols/font-400`. `DESIGN.md` / `DESIGN_CODE.md` are gitignored
  reference docs for that theme.
- Deploy: `bun run build` → tar (exclude `node_modules`, `.git`,
  `.svelte-kit`, `data`, `.env`) → scp → unpack → `npm install --omit=dev
--legacy-peer-deps` (peer-dep bypass for the better-sqlite3 vs better-auth
  mismatch) → `sudo systemctl restart scrinium` → curl verify.
- Full background (VPS, Oracle Cloud firewall gotchas, Caddy, systemd backups)
  in `DEPLOY.md`.
