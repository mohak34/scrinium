# AGENTS.md — Scrinium

Scrinium is a lightweight, self-hosted, Obsidian-style notes app. SvelteKit 5
+ CodeMirror 6 live-preview editor, plain markdown files on disk, sqlite
metadata cache, Google-OAuth-gated login. This file is the project memory:
read the relevant section before changing code.

## Commands

Use `bun` (never npm/yarn — see global rules). The lockfile is `bun.lock`.

- `bun run dev` — start the dev server on `http://localhost:5173`. Compiles
  (`dev` = `vite dev`). Bounces you to `/login` (auth gate).
- `bun run check` — the verification gate: `svelte-kit sync && svelte-check`.
  MUST be clean before committing: 0 errors, 0 warnings.
- `bun run build` / `bun run preview` — production build / serve build.
- `bun install` — install/update dependencies.

## Stack

- SvelteKit 2 + Svelte 5 (runes), Vite 6, TypeScript
- CodeMirror 6 (`@codemirror/*` + `@lezer/*`) for the editor
- better-auth (Google OAuth + email allowlist) — server-side
- better-sqlite3 — sessions + note-metadata cache (NOT a source of truth)
- Media/preview overlays are hand-rolled (no heavy image libs)

## Directory map

```
src/
  hooks.server.ts          -> auth gate (redirects to /login)
  lib/
    server/
      auth.ts              -> Better Auth + Google OAuth + ALLOWED_EMAILS check
      db.ts                -> sqlite (sessions + note metadata cache)
      vault.ts             -> filesystem read/write, path-traversal-safe
      indexer.ts           -> note metadata indexer
    editor/
      livePreview.ts       -> the live-preview decoration engine (READ THIS ONE)
      markdownSetup.ts     -> CM6 markdown language + theme
      formatting.ts        -> formatting helpers
      CodeEditor.svelte    -> Svelte wrapper around the CM6 EditorView
    components/
      CommandPalette.svelte, ContextMenu.svelte, FileTree.svelte,
      SearchBox.svelte, Sidebar.svelte, TabBar.svelte, TopBar.svelte
    stores/
      vault.ts             -> notes state + debounced autosave + tab state
      filetree.ts          -> sidebar file tree
      actions.ts           -> tippable actions
    auth-client.ts
  routes/
    +page.svelte           -> main app shell
    login/+page.svelte
    api/
      auth/[...all]/       -> Better Auth handler
      notes/[...path]/     -> note CRUD
      tree/                -> vault listing for the sidebar
      search/              -> note search
      assets/[...path]/    -> static asset serving
      attachments/         -> attachment handling
vault/                      -> default local vault (markdown files live here)
data/scrinium.db            -> sqlite file (gitignored, safe to delete+rebuild)
deploy/                     -> Caddyfile, systemd unit, backup.sh (see DEPLOY.md)
```

## The live-preview editor (high-traffic area)

`src/lib/editor/livePreview.ts` is the heart. The document is always plain
markdown. On every edit/cursor move it re-walks the Lezer syntax tree and,
node by node, decides whether to:

- style in place (`Decoration.mark`) — e.g. bigger heading text
- hide it entirely (`Decoration.replace`) — e.g. the `**` around bold text
- swap for a real widget (`Decoration.widget`) — e.g. a clickable checkbox

Core rule (Obsidian's pattern): a mark is only hidden "unless the cursor is
on that line". Marks use an `active`/`isLineActive` check: hidden widgets get
gated with `!active` so that moving the cursor onto the line re-exposes the
raw markdown for editing, and away hides it again. This holds in `previewOn`
(full-preview) mode too.

Task checkboxes: `TaskMarker` -> `CheckboxWidget`. The checkbox replacement
MUST be `!active`-gated too: when the cursor is on a task line the raw `[ ]` /
`[x]` must remain editable text so the caret can cross the bracket. See commit
`dd206ec`. When adding any new hideable element, keep the `!active` guard or
you'll reintroduce the blocked-caret bug.

Keys to know:
- `previewModeEffect` / `previewOn` (Enter preview = Escape; click to exit)
- `noteDirEffect` / `noteDirField` — the note's folder for resolving relative
  images-urls
- Extend `HIDEABLE_MARKS` / add Lezer node-name cases to cover more markdown.
  Tables, nested lists, block quotes still render as plain text (MVP).

## Auth & login

- `ALLOWED_EMAILS` in `.env` is the actual allowlist. Google's consent screen
  only proves who signed in; `databaseHooks.user.create` in
  `src/lib/server/auth.ts` rejects everyone not in the list. Do NOT remove it.
- `.env` is gitignored; `.env.example` documents the keys.

## Branches / current work

- `main` is the live line. The `design/revamp` theme overhaul was merged in
  (`d7bcb00 Merge branch 'design/revamp'`): `src/lib/design/theme.css`,
  `@fontsource-variable/inter`, `@material-symbols/font-400`.
- `DESIGN.md` (color/token spec) and `DESIGN_CODE.md` (HTML/Tailwind mock) are
  gitignored reference docs for the theme, uncommitted on purpose.
- Deprecated branches are removed after merging.

## Conventions (project + global rules)

- NEVER commit secrets or `.env`. `.env`, `data/`, `node_modules/`, `.svelte-kit/`
  are gitignored.
- Commit style: short `fix:` or `feat:`, message. Each logical change is its
  own isolated commit (so it can be reverted individually). Commit only when
  the user asks. Do not stage unrelated untracked files (e.g. DESIGN*.md).
- No code comments unless asked. No emojis. Clean, self-documenting code.
- Run `bun run check` after changes and keep it at 0 errors / 0 warnings.
- Headless-Chrome test harness uses CDP on port 9222; the dev server must be
  running to verify editor behavior.

## Known rough edges

- The note-metadata sqlite table is a cache, not source of truth. If it
  drifts, delete `data/scrinium.db` and re-run `bunx @better-auth/cli migrate` —
  vault `.md` files are unaffected.
- No image/attachment upload endpoint yet; drop files in `vault/attachments/`
  and reference with relative markdown links.
- Full deployment notes in `DEPLOY.md` (VPS, Oracle Cloud firewall gotchas,
  Caddy/systemd/backup).