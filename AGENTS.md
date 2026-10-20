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
   hideable element keeps the guard, or it is a regression. Tables are
   the one exception: they never show raw on cursor lines, the cell
   editor gives each cell its raw source instead (tableBlock.ts).
2. **Treating the note cache as authoritative.** `note_meta`, `note_fts`
   and `note_docs` cache the vault (recent notes, search). Everything else
   in `data/scrinium.db` (tasks, projects, shares, tokens, auth) is the only
   copy: never delete the file. If the cache drifts, stop the app, run
   `node -e "const d=require('better-sqlite3')(process.argv[1]);d.exec('DELETE FROM note_meta; DROP TABLE note_docs')" data/scrinium.db`
   from the app directory and start it; boot clears the search index and
   the first search rebuilds it from the vault. Never let a feature depend
   on the cache being present or correct.
3. **Committing secrets.** `.env` is gitignored for a reason. `ALLOWED_EMAILS`
   plus `BETTER_AUTH_SECRET` gate the whole deployment. Never log or commit
   them.
4. **Breaking the title ↔ filename sync loop.** For `.md` notes the first `# `
   heading and the filename are kept identical (see `scheduleTitleSync` /
   `syncFilenameToTitle` in `src/lib/stores/vault.ts`). Both directions guard
   against loops by comparing sanitized values before acting; a rename also
   flushes pending saves first. Don't add a second path that renames notes
   without going through `renameNote` (moves included), or tabs/pins/
   activePath and queued saves drift. A rename of the open note moves
   `shownNote()` with it, so the page keeps the editor instead of reloading.
5. **Bypassing the bin indexes.** Deletes move files into `VAULT_DIR/.trash/`,
   archiving into `VAULT_DIR/.archive/`, flat as `<stamp>-<name>`, with the
   original path in that bin's `.index.json`. Both bins go through
   `moveIn` / `restore` / `archiveToTrash` in `src/lib/server/bins.ts`,
   which also move task links to the bin path and back, drop share links
   and metadata, and keep archived notes in the search index under their
   `.archive/` path (search leaves them out unless `scope` asks). If you
   touch bin internals, keep the index in sync or restore falls back to
   guessing from the name. Emptying the trash never touches the archive.
   The notes API reads dot paths (so archived notes open read-only) but
   refuses to write to them.
6. **Vertical margins on block widgets.** CodeMirror measures block widgets
   without their margins, so `margin: X 0` on `.cm-math-block` / `.cm-image`
   desyncs the height map — gutter numbers, cursor coords and arrow targets
   all shift below the widget, compounding per block. Put spacing in padding.
7. **Autosave is a per-path queue.** `scheduleSave` keys unsaved text by
   note path; saves run one at a time, each sends the note's text as of
   that moment, and failed ones retry. Renames, deletes and content
   rewrites run inside that same queue via `afterSaved`, which writes
   pending text first and skips the change when a save failed; saves typed
   meanwhile wait, so they never hit a path that is mid-rename or
   mid-delete. Content rewrites (properties, link conversion, title sync)
   go through `rewriteNote`: the note in the editor is rewritten in the
   editor's live text and autosaved like typing, never by pushing a
   server-derived copy over it. `flushSave()` resolves false on a failed
   write - anything else that reads the server copy must check it. The editor is
   one view for every note: a note switch goes through `showNote`, which
   loads in the queue and prefers the note's unsaved text over the server
   copy (so a failed save never reopens stale), then `setDoc(text, true)`,
   which also drops undo history - never swap docs another way. Keystrokes
   save to `shownNote()`, which lags `activePath` until the load lands. A
   load the user already left is skipped; a failed load of the selected
   note sets `activePath` back to `shownNote()` (or none), so the chrome
   never names a note other than the one being typed into.
8. **Path prefixes in SQL use `under()` from db.ts**, not `LIKE 'x/%'`
   (case-insensitive, `_` and `%` are wildcards).
9. **Vault mutations go through `withVaultLock`** in `src/lib/server/vault.ts`.
   Writes, mkdirs, renames, trash, restore and purge run one at a time, so a
   "target is free" check and the move onto it can't be split by another
   request (`fs.rename` silently replaces files). A new function that
   changes the vault takes the lock; locked functions never call each other,
   or the queue deadlocks. The lock is per process: one app process per
   vault.

## Commands

Use `bun` (never npm/yarn) for dev tooling. The lockfile is `bun.lock`.

- `bun run dev` — dev server on `http://localhost:5173`. Bounces to `/login`.
  With `DEV_LOGIN_EMAIL` set (plus `VAULT_DIR`/`DATABASE_PATH` pointing at
  a throwaway vault) it signs every request in as that email, for previews
  Google sign-in can't reach. Dev only: builds ignore it.
- `bun run test` — unit tests in `tests/` (pure modules: link parsing,
  relinking). Kept outside `src` so svelte-check never sees `node:test`.
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
  wikilinks.ts (shared `[[link]]` parse/resolve, `[[#heading]]` for the
  note itself, `wikiTargetFor` (shortest unambiguous way to write a link),
  `wikilinkNewPath` (where an unresolved link creates its note, folders
  included); the editor pill `WikilinkWidget` and its click-to-open/create
  live in livePreview.ts - a heading link opens through `openNoteAt`, which
  jumps once `showNote` lands,
  fed the note list by `wikiCtxField` there; `[[` completion in
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
  a `Compartment` gated by `settings.editor.vimMotions`, its code
  imported the first time the toggle is on (`cmOf` is null until then) - insert-mode
  helpers bail out in normal mode via `inVimNormal`, editor Esc drops to
  normal mode, normal-mode Esc enters preview, and app-level Esc exits
  preview via `exitPreview` so keyboard flow never strands on the mouse;
  no CodeMirror status panel - the mode lives at the right end of the app
  StatusBar next to the save state (shared `stores/vim.ts`; caret position
  comes from `stores/editor.ts`), notice toasts and a `/`+`:` command line
  are editor chrome driven by vim's dialog/mode-change signals),
  mathBlock.ts (display math as a StateField: ```math fences + own-line
  `$$`, block replaces; ranges shared via mathRanges.ts so inline `$`
  in `livePreview.ts` never overlaps a block replace),
  mathRender.ts (KaTeX for the math widgets, imported with its CSS on
  the first widget drawn; a widget shows its source until then),
  mathComplete.ts (`\command` completion source, math regions only),
  mathSnippets.ts (Tab word/subscript and Space fraction triggers),
  tableBlock.ts (top-level GFM tables as a StateField like mathBlock:
  the table is always one block widget rendered by the lazy-loaded
  renderNote.ts, and editing is per cell. When the main selection sits
  in a cell, `syncCell` mounts a small nested EditorView in that td for
  the cell's raw source; its edits are written back to the main doc as
  one transaction each (same userEvent, so undo groups like typing and
  runs through the main history), and the widget skips repainting for
  its own echo. A column that repeats a value offers the column's
  values as completions in that cell editor (`columnChoices`), so a
  status column edits like a select with nothing declared. Tab/Enter/arrows step cells via the main selection;
  typed `|` is escaped. In vim normal mode the cell is only outlined
  and j/k move by row (vim's own j/k jump over the widget); `i`/`a`
  open it through `tableVim`, a facet CodeEditor provides. Row/column/
  align/sort palette commands rewrite the whole table through
  `readTable`/`writeTable` in tableRanges.ts; "Table: edit as markdown"
  shows the raw lines until the cursor leaves. Ranges from
  tableRanges.ts so `livePreview.ts` never decorates inside a table),
  docRanges.ts (`perDoc`: a whole-doc scan cached per document and
  syntax tree, so math, table, callout and frontmatter ranges are found
  once per edit however many plugins ask; plus binary-search lookups
  over sorted, non-overlapping ranges - never `.some()` over a range list
  inside a per-match loop),
  yankFlash.ts (mini.nvim-style yank flash: line deco from the vim
  "<N> lines yanked" status notice via the facade dialog signal, read off
  live selection state so a stale range can never paint),
  formatting.ts.
- `src/lib/server/` — vault.ts (filesystem, path-traversal-safe, plus the
  trash and archive bins: move/list/restore/purge backed by each bin's
  `.index.json`), bins.ts (the bookkeeping around a bin move that routes
  call), db.ts (sqlite cache
  + api_tokens table), shares.ts (public share links: random id → live vault
  path, optional scrypt password hash; rename/delete follow the file),
  auth.ts (better-auth, Google, allowlist), indexer.ts,
  google.ts (read-only Calendar overlay: refreshes the stored Google token,
  reads every calendar ticked in Google's sidebar with pagination; only a
  revoked grant or missing scope means "reconnect", outages are a 502).
  `src/lib/calendar.ts` keeps all-day events as date-only strings so the
  browser picks the local day - never `Date.parse` a Google `date` on the
  server, it lands a day early west of UTC.
  assets.ts (`assetResponse`: streams a vault file out; only images, PDF,
  audio, video and plain text are served inline, everything else as an
  `octet-stream` download, all under `nosniff` + CSP `sandbox` - a vault
  HTML/SVG served inline would run with the session). Uploads are raw
  bodies (`POST`/`PUT /api/attachments?name=&folder=`, any type, 100 MB)
  streamed to disk by `writeAssetStream` in vault.ts; never buffer one in
  memory, the VPS has 1 GB. SvelteKit drops bodies without a
  `Content-Type`, so uploaders always send one. The 100 MB cap must stay
  under `BODY_SIZE_LIMIT` in `deploy/scrinium.service` (`MAX_UPLOAD_BYTES`
  in assets.ts). `PUT /api/assets/<path>` overwrites an existing non-note
  file the same streamed way (`replaceAssetStream`, atomic rename under
  the vault lock); the PDF pane saves annotations through it.
  `src/lib/attachments.ts` (`isImagePath`, `attachmentMarkdown`,
  `resolveAssetUrl`) is shared by the editor, MCP and share pages.
  mobileAuth.ts (Google ID-token verification + API-token issue/verify),
  mcp.ts (MCP tools for agents; each tool calls the REST routes through
  SvelteKit's in-process `fetch`, so validation and index/link bookkeeping
  live only in the routes - add a tool by wrapping a route, never by
  touching the vault or db directly; write tools call `onWrite` after
  success, which the route records in `agent_actions` for bearer callers -
  a new write tool must call it too).
- `src/lib/stores/` — client state: vault.ts (notes + debounced autosave +
  tabs + title↔filename sync + trash and archive actions), bins.ts (the
  open Archive/Trash/Review view), filetree.ts, actions.ts,
  settings.ts (editor prefs persisted to localStorage), tasks.ts (tasks
  and projects: lists, open drawer, API calls), editor.ts / vim.ts (caret
  and vim mode for the StatusBar), settingsDialog.ts.
- PDFs: `components/PdfPane.svelte` shows a vault PDF beside the editor
  (`stores/pdf.ts` holds its path; the file tree and Ctrl+click on a PDF
  link set it). The root page loads it, and `src/lib/pdf/pdfjs.ts` loads
  pdf.js, only when a PDF opens. pdf.js's fonts, CMaps and wasm decoders
  are bundled through `import.meta.glob` and handed over by file name.
  Highlights, ink and text notes are written into the PDF as standard
  annotations (`saveDocument`) and PUT back over the file, debounced and
  again on close; there is no sidecar store. The asset route caches for
  an hour, so the pane always fetches with `no-store`.
- `src/lib/print/renderNote.ts` — `renderNoteToHtml`, the one note→HTML
  renderer (markdown-it plus the editor's math, code, callout, wikilink
  and tag parsing). Used by `/print` (NoteBar's Print / PDF) and the
  `/s/[id]` share viewer; a markdown feature that should show up in PDFs
  and shares goes here as well as in the editor. It builds its own GFM
  parser from `@lezer/markdown` and must never import `livePreview.ts`,
  `markdownSetup.ts` or `@codemirror/lang-markdown`: any of them ships the
  whole editor to share pages.
- `src/lib/components/` — CommandPalette, ContextMenu, FileTree, SearchBox,
  Sidebar, TabBar, ShortcutHelp (the `?` overlay), ReminderToasts (mounted
  in the root layout except on login and share pages; polls
  `POST /api/tasks/due` every 30 s while the tab is visible).
  CommandPalette is mounted in the root layout too, so Ctrl+K works on
  every app page (`stores/palette.ts`). It searches notes and tasks, adds
  an Inbox task from the query, and holds the global commands; a page adds
  its own (editor formatting on Notes, views on Board) with
  `usePageCommands` from its `onMount`. A new feature that can run from
  the keyboard gets a palette command in one of the two places. The root
  layout also owns the Space leader and the `?` overlay on every page;
  `leader: 'x'` on a page command makes it Space x. `src/lib/keyNav.ts`
  moves focus between task cards and rows (`data-nav` items) on Tasks and
  Board.
  The notes sidebar is split by project (`src/lib/projects.ts`): a
  switcher shows All projects or one, each project is a collapsible
  section (Quotidian, everything outside a project folder, first) holding
  its own pins and its file tree, and global pins sit above them. A
  section folds under its folder path in `collapsedDirs` ("" for
  Quotidian), so its pins fold with it. Pins live in `pinnedPaths`; the
  global ones are also in `globalPins`, the rest show in their project's
  section. In one project, search passes `?folder=` to `/api/search`.
  `sidebarDrag.ts` is the sidebar's drag: pointer events, not HTML5
  drag-and-drop. Tree rows move into folders (a file row means its folder,
  a section header or its empty space the section's folder), notes dropped
  on the global Pinned list pin everywhere and on their own project's pins
  pin there, pins reorder, move into a folder they are dropped on (staying
  pinned), and unpin when dropped anywhere else. Targets are found by
  `data-*` attributes under the pointer; the lifted row and its "Move to
  X" label live in Sidebar.svelte. A pinned note shows only in its pin
  list, not in the tree; its pin row carries the file menu minus Rename.
  `bins/BinsView.svelte` is the full-page Archive / Trash / Review view,
  mounted (and its code loaded) by the root layout only while open,
  through `openBins(tab, focus?)` (`stores/bins.ts`) from the sidebar footer, the palette, task links and
  wikilinks to archived notes. Each tab is a list plus a read-only
  `NotePreview` (renderNoteToHtml). Review lists stale notes (old, nothing
  links to them, no task, share or pin) from `/api/archive/review` for
  bulk archive or trash. Unused files lists vault files whose name no live
  or archived note contains (a plain text match, so it errs toward keeping)
  from `/api/archive/unused`, to trash in bulk; it flushes saves before
  scanning and scans again before trashing. It swallows keydown like the
  settings dialog.
  `src/lib/archive.ts` holds the archive types and path mapping shared by
  the routes, MCP and the view.
  `src/lib/relink.ts` is the one link scanner: relative markdown link
  destinations (`[t](url)`, `![a](url)`, `[ref]: url`) and wikilinks, found
  with the editor's Lezer parser so code is never touched. `noteLinks`
  lists where a note's links go (backlinks, archive review). `relinkNote`
  fixes links after a move; wikilinks need resolvers for the vault before
  and after it, since a move can also hand a bare name to another note
  (old links then get pinned by path). `renamePath` in vault.ts runs it
  inside the vault lock over the moved notes, every note linking into the
  move and archived and trashed notes (from their original path); the
  PATCH route reindexes and returns those paths. A restore that lands
  under a new name fixes its own relative links. `renameNote` applies the
  same `relinkNote` to the open note's live text and to queued unsaved
  text, so autosave never writes the old links back. Moves that skip
  `renamePath` leave broken links.
  `settings/SettingsDialog.svelte` is the one settings surface:
  a modal the root layout mounts (and loads) only while open, through
  `openSettings(page)` (`stores/settingsDialog.ts`) from the sidebar footer
  and the palette. Pages: Editor, Keyboard (vim toggle + the shortcut list
  from `src/lib/shortcuts.ts`, shared with the `?` overlay), Attachments,
  Account (Google Calendar status), Devices (phone tokens, the unlabeled
  ones), Agents (MCP URL, labeled agent tokens and their activity),
  Shared links (every share from `GET /api/shares` without `?path`:
  copy, revoke, set or remove the password), About. While open
  it swallows keydown in the capture phase so app shortcuts never fire
  underneath; Esc closes it.
- `src/routes/` — `/` (+page.svelte shell), `/login`, `/print`, `/tasks/*`,
  api/{auth,notes,tree,search,assets,attachments,tokens,trash,archive,backlinks,
  tags,tagged,tasks,projects,calendar}.
  `/api/mcp` is the stateless MCP endpoint (streamable HTTP, JSON
  responses) behind the normal /api gate. Mobile-only
  endpoints: `POST /api/auth/mobile` (Google ID token → long-lived API token)
  and `GET /api/notes/manifest` (metadata-only delta sync listing). Sharing:
  authed `GET/POST /api/shares` + `PATCH/DELETE /api/shares/[id]` (PATCH
  sets or, with `null`, removes the password and drops that link's image
  proofs), public
  `GET/POST /api/share/[id]` (+ `/assets/<n>`: the n-th image the note
  references, from `shareImages` in shares.ts - never a vault path) and the `/s/[id]`
  viewer (ShareModal.svelte manages links from the note bar).
- `src/lib/design/theme.css` — the only design tokens: surfaces (`--bg`
  reading area #0a0a0a, `--panel` chrome #030303), text steps, the Palo Alto
  accent split into `--accent-fill` (solid #175e54 under white text) and
  `--accent` (lifted ink #5db8aa for text, icons, thin lines; the fill is
  unreadable as text on near-black), fonts (`--font-read` Atkinson
  Hyperlegible Next, `--font-ui` Space Grotesk, `--font-mono` JetBrains Mono).
  The old Material-style names (`--primary`, `--surface-container-*`,
  `--on-surface*`) are aliases kept for components not yet moved over; new
  code uses the tokens. Never fill with `--accent` under text.
  It also holds the one table look shared by the editor widget
  (`.cm-table-block`) and the share/print sheet (`.paper`).
- App chrome: `AppSwitcher.svelte` (top-left title on every page; app list in
  `src/lib/apps.ts`, `Ctrl+Shift+1..4` handled in the root layout - plain
  `Ctrl+digit` belongs to editor headings and browser tabs), `NoteBar.svelte`
  (crumbs + preview/PDF/more/Share/right-panel toggle), `StatusBar.svelte`,
  `AppActions.svelte` (Archive/Trash/Settings/Sign out buttons: notes sidebar, Tasks
  sidebar, Board footer via `PageFooter actions`; not on Calendar),
  `PanelSection.svelte` (right-panel section frame: Outline, Backlinks,
  NoteTasks, Tags, FileInfo in that order), `PageFooter.svelte`.
- Tasks: `src/lib/taskModel.ts` is the single list of statuses (`inbox`,
  `todo` = "This week", `doing`, `waiting`, `done`), areas and priorities,
  shared by the API validation and the UI. Rows live in sqlite (`tasks`,
  `task_links`), not the vault. `waiting_since` is stamped when a task
  enters Waiting and cleared when it leaves; the task routes (and the MCP
  task tools) accept an earlier start, never a future one. `GET /api/tasks?note=` lists tasks linked to a
  note; note renames move `task_links` with the file like shares.
  Projects: a `projects` row registers a folder at the vault root, never
  a nested one (`POST /api/projects` creates it; `NewProjectDialog.svelte`
  from the sidebar, the palette or the board's tabs); tasks with no
  project are Quotidian. `tasks.project` holds that folder path, and a note/folder
  rename moves both via `renameProjects`. Rows outlive a trashed folder;
  a restore under a new name moves the ones whose folders came back.
  Subtasks always carry their parent's project: the task routes enforce
  it and `setSubtreeProject` cascades a change on the parent.
  `onMainBoard` in taskModel.ts keeps a project's Inbox (its backlog) off
  the All board, the list and `get_agenda`; the board's tabs set
  `?project=<folder>` for one project and an empty `?project=` for
  Quotidian (`boardHref`). The calendar shows every dated task.
  `/tasks` (list + filters), `/tasks/kanban` (columns or by-area lanes, both
  drag and drop), `/tasks/calendar` (month grid + day agenda, drop to
  schedule) share `TaskDrawer.svelte` docked by `tasks/+layout.svelte`.

## Auth & access

- `ALLOWED_EMAILS` in `.env` is the actual allowlist. Google's consent screen
  only proves who is who; `isAllowedEmail` in `src/lib/server/auth.ts`
  (used by `databaseHooks.user.create`, `/api/auth/mobile`, and
  `hooks.server.ts` on every request for sessions and bearer tokens)
  rejects everyone not listed. Removing an email and restarting the app
  locks out its live sessions and tokens too. Do not remove it.
- **Mobile API tokens**: `POST /api/auth/mobile` verifies a Google ID token
  (audience = `GOOGLE_CLIENT_ID`; the Android app requests its token with
  that ID as `serverClientId`, so no separate Android credential exists) and
  issues a random 256-bit token. Only its SHA-256 hash is stored in the
  `api_tokens` table. API requests send `Authorization: Bearer <token>`;
  `hooks.server.ts` falls back to the token lookup when no cookie session
  exists. Tokens never expire server-side — list and revoke them in
  Settings > Devices (phones) or Agents via `GET/DELETE /api/tokens`.
- **Agent tokens**: the same table. `POST /api/tokens { label }` (browser
  session only) mints a labeled token for an MCP client; the raw value is
  shown once. Phone tokens have no label. `GET /api/tokens/activity`
  lists what an agent token changed (30 days, dropped on revoke).
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

- Live at `https://scrinium.mohak.dev` on the VPS (SSH target is the
  `VPS_USER@VPS_HOST` pair stored in the Actions secrets).
- Deploys run through GitHub Actions (`.github/workflows/deploy.yml`): every
  push to `main` typechecks, builds, rsyncs to `/opt/scrinium/app`, runs
  `npm install --omit=dev --legacy-peer-deps` (recompiles native
  `better-sqlite3`), restarts `scrinium.service`, and smoke-tests the site. Secrets used:
  `DEPLOY_KEY`, `VPS_HOST`, `VPS_USER`, `SITE_URL`.
- The rsync excludes `node_modules .git .svelte-kit data vault .opencode
  .env*` — notes and secrets are never shipped.
- systemd unit `scrinium.service` runs `node build/index.js` on
  `localhost:3000` (MemoryMax=500M); Caddy reverse-proxies + Let's Encrypt TLS.
- Fonts ship as packages (`@fontsource-variable/atkinson-hyperlegible-next`,
  `space-grotesk`, `jetbrains-mono`) plus `@material-symbols/font-400`, of which
  only `outlined.css` is imported; that font carries the FILL axis used by
  the `.fill` icon class.
- The vault and `data/` live OUTSIDE `app/` on the box and are never touched
  by deploys.

## Shipping a change

1. **Make and verify the change locally.** Edit and run `bun run check`
   (0 errors / 0 warnings); for editor work confirm the behavior in the dev
   server.
2. **Keep the docs honest.** If the change touches the editor, auth, or
   deployment, update this file (`Where code lives`, gotchas) and the README
   if it is user-facing. Docs ship in the same commit as the code — commit
   messages are short `fix:` / `feat:`.
3. **Commit on a branch, ship through a PR.** One branch per fix or feature
   (`fix/...`, `feat/...`, `docs/...`), never commits on `main`. The PR runs
   no CI (the workflow only triggers on `main`), so step 1's check is the
   gate.
4. **Merging the PR is the deploy.** The maintainer merges; that push to
   `main` runs the deploy workflow. Watch the Actions run, hard-refresh
   `https://scrinium.mohak.dev` so the browser drops the old cached build,
   then delete the merged branch.

**Manual fallback** (only if Actions is broken). From the repo root:

```bash
bun run build
tar -czf /tmp/scrinium-src.tgz \
  --exclude node_modules --exclude .git --exclude .svelte-kit \
  --exclude data --exclude vault --exclude .env --exclude .opencode .
scp /tmp/scrinium-src.tgz $VPS_USER@$VPS_HOST:/tmp/
ssh $VPS_USER@$VPS_HOST \
  'sudo bash -c "cd /opt/scrinium/app && tar -xzf /tmp/scrinium-src.tgz && \
   npm install --omit=dev --legacy-peer-deps && \
   chown -R scrinium:scrinium /opt/scrinium && systemctl restart scrinium"'
```

**Schema (auth/DB) changes:** nothing to run. On startup the `init` hook in
`src/hooks.server.ts` runs better-auth's `getMigrations` (creates missing
auth tables/columns) and `db.ts` adds missing task tables/columns. The VPS
has 1 GB of RAM, so keep heavy installs off it; a deploy only runs the
production `npm install` and a restart.

**Never** `rm -rf`, `chown`, or otherwise touch `vault/` and `data/` on the
VPS during a deploy — those hold the notes. Only `/opt/scrinium/app` is
overwritten.
