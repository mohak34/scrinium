# Scrinium

Scrinium is a self-hosted, Obsidian-style notes app. Your notes live as plain
markdown files on your own machine, open in a CodeMirror 6 live-preview
editor, and are gated behind a Google OAuth. It is a lightweight, single-user
app you deploy on your own VPS.

## "Wait, what is this?"

There are a hundred notes apps. Most lock your notes in a database and keep
them somewhere you can't reach. Scrinium puts the door on the inside: every
note is a real `.md` file in a folder you own. Edit it with any text editor,
back it up with `git` or `tar`, migrate it by copying a directory.

What makes it feel like Obsidian is the live preview. Headings render bigger,
`**bold**` hides its stars, and `- [ ]` becomes a clickable checkbox — but the
moment your cursor lands on a line, the raw markdown reappears so you can edit
it. Move away and it hides again. Same instinct as Obsidian's "hide until
you're editing" behavior, but no proprietary format and no vendor lock-in.

## Features

- **Plain markdown on disk** — every note is a `.md` file in `VAULT_DIR`.
- **Live-preview editor** — the whole engine is one file
  (`src/lib/editor/livePreview.ts`): hide marks, reveal them on the active line.
- **Title = filename** — the first `# ` heading and the note's filename stay
  in sync; edit one and the other follows.
- **Trash** — deletes go to `.trash/` on disk with their original path
  recorded; restore or purge from Settings > Trash.
- **Google OAuth sign-in** — backed by an explicit `ALLOWED_EMAILS` allowlist,
  not just "whoever has a Google account".
- **Task checkboxes** — click to toggle `[ ]` ↔ `[x]`; on the active line the
  raw brackets come back and the caret crosses them freely.
- **Tasks, Board and Calendar** — tasks carry a status (Inbox, This week,
  Doing, Waiting, Done), an area (College, Learning, Work, Life), priority,
  due date, reminder, subtasks and linked notes. The board shows status
  columns or one row per area; the calendar shows tasks next to read-only
  events from every calendar you have ticked in Google Calendar (refreshed
  on focus) and schedules a task when you drop it on a day.
- **App switcher** — the title in the top-left corner of every page opens
  Notes, Tasks, Board and Calendar with a live summary of each;
  `Ctrl+Shift+1` to `4` jumps straight there.
- **Wikilinks + backlinks** — `[[Note]]`, `[[Note|alias]]`, `[[Note#section]]`
  render as links with `[[` autocomplete; clicking an unresolved link creates
  the note. The right panel lists the outline, every note linking to the open
  one, the tasks linked to it, its tags and its properties.
- **A small editor chrome** — file tree with pinned notes, tabs, a note bar
  (share, PDF, preview), a status bar (position, words, save state, vim mode),
  search, command palette and a settings dialog (editor prefs stay local;
  trash and API tokens for phones and agents live there too). Dark theme only: Atkinson Hyperlegible
  Next for notes, Space Grotesk for the interface, JetBrains Mono for code.
- **Attachments** — paste or drop any file into a note (up to 100 MB). Images
  embed and open in an in-app overlay; other files become links that open or
  download on Ctrl/Cmd+click.
- **Share links** — per-note public read-only links (`/s/…`) with optional
  password protection; manage them from the Share button in the note bar. Links show
  the note's live content and die when revoked or the note is deleted.
- **MCP server for agents** — `/api/mcp` lets an AI agent (Muse, Claude,
  ChatGPT) search, read and edit notes, and create, update and nest tasks.
  See "Connecting an agent" below.
- **Thin by design** — one process, one small sqlite cache, no graph view, no
  plugin marketplace, no bloat. The architecture stays open to a
  desktop or mobile client later without a rewrite.

## Getting started (local)

> [!WARNING]
> Scrinium is early-stage and focused. Expect rough edges: tables, nested
> lists, and block quotes render as plain text for now.

```bash
bun install        # deps sync with bun (see note below)
bun run dev        # -> http://localhost:5173
```

It will bounce you to `/login`. Copy `.env.example` to `.env` and fill:

```dotenv
VAULT_DIR=./vault
DATABASE_PATH=./data/scrinium.db
BETTER_AUTH_URL=http://localhost:5173
BETTER_AUTH_SECRET=<openssl rand -base64 32>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ALLOWED_EMAILS=you@gmail.com
```

Add `http://localhost:5173/api/auth/callback/google` to that Google OAuth
client's authorized redirect URIs. The auth tables are created on first
start.

> [!NOTE]
> Development uses bun (the lockfile is `bun.lock`). Anything that runs on a
> server — the VPS deploy and native modules like `better-sqlite3` — uses npm,
> because those must build against the target box.

## Connecting an agent

Scrinium speaks MCP (Model Context Protocol) over streamable HTTP at
`https://<your-host>/api/mcp`. In Settings > Agents, create a
token named after the agent, copy it, and give the agent the URL plus the
token as `Authorization: Bearer <token>`. Revoke it on the same page.

For Meta Muse, ask: "Build a custom integration to Scrinium. Its MCP server
is https://<your-host>/api/mcp with bearer auth. Save it as a skill." and
paste the token into its credential prompt, not the chat.

Tools: notes (`list_notes`, `search_notes`, `read_note`, `create_note`,
`update_note`, `edit_note`, `append_to_note`, `move_note`, `create_folder`,
`delete_note`, `list_trash`, `restore_from_trash`, `share_note`), attachments
(`upload_attachment` up to 5 MB as base64, `read_attachment`; bigger files go
through `curl -T` against `/api/attachments`, which the tool description
spells out), tags and
links (`list_tags`, `find_notes_by_tag`, `get_backlinks`) and tasks
(`list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`,
`link_task_to_note`, `unlink_task_from_note`, and `get_agenda` for overdue,
today, next 7 days, doing, waiting and inbox in one call). Dates are ISO 8601
with a UTC offset.

Every change an agent makes is listed under its token's Activity button for
30 days.

## Deployment

Scrinium is a single Node process tucked behind a reverse proxy. The included
`deploy/` folder has a Caddyfile, a systemd unit, and a backup script; the full
Oracle-VPS runbook lives in `DEPLOY.md` (kept local, not tracked). The short version:

```bash
bun run build                       # adapter-node -> build/
```

```ini
# /etc/systemd/system/scrinium.service
[Unit]
Description=Scrinium
After=network.target

[Service]
User=scrinium
WorkingDirectory=/opt/scrinium/app
EnvironmentFile=/opt/scrinium/app/.env
ExecStart=/usr/bin/node build/index.js
Restart=on-failure
RestartSec=5
MemoryMax=500M
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```caddy
scrinium.yourdomain.com {
    reverse_proxy localhost:3000
}
```

`DEPLOY.md` (local, gitignored) has the DNS, firewall, and backup details.

## Reading list

- `AGENTS.md` — how the live-preview engine works and the rules that keep it
  maintainable. Read it before touching the editor.
- `src/lib/editor/livePreview.ts` — the entire decoration engine, one file.
- `DESIGN.md` / `DESIGN_CODE.md` / `DEPLOY.md` — local-only docs, gitignored
  (theme spec, design mock, production runbook). Not in the repo.
