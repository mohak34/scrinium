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
- **Google OAuth sign-in** — backed by an explicit `ALLOWED_EMAILS` allowlist,
  not just "whoever has a Google account".
- **Task checkboxes** — click to toggle `[ ]` ↔ `[x]`; on the active line the
  raw brackets come back and the caret crosses them freely.
- **A small editor chrome** — file tree, tabs, search, command palette.
- **Attachment preview** — view images in an in-app overlay.
- **Thin by design** — one process, one small sqlite cache, no graph view, no
  backlinks, no plugin marketplace, no bloat. The architecture stays open to a
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
client's authorized redirect URIs, then create the auth tables:

```bash
bunx @better-auth/cli migrate
```

> [!NOTE]
> Development uses bun (the lockfile is `bun.lock`). Anything that runs on a
> server — the VPS deploy and native modules like `better-sqlite3` — uses npm,
> because those must build against the target box.

## Deployment

Scrinium is a single Node process tucked behind a reverse proxy. The included
`deploy/` folder has a Caddyfile, a systemd unit, and a backup script; the full
Oracle-VPS runbook lives in [DEPLOY.md](DEPLOY.md). The short version:

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

Caddy issues Let's Encrypt TLS automatically. See
[DEPLOY.md](DEPLOY.md) for the DNS, firewall, and backup details.

## Reading list

- `AGENTS.md` — how the live-preview engine works and the rules that keep it
  maintainable. Read it before touching the editor.
- `src/lib/editor/livePreview.ts` — the entire decoration engine, one file.
- `DESIGN.md` / `DESIGN_CODE.md` — theme spec + a design mock.
- `DEPLOY.md` — production deployment runbook.