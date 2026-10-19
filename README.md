# Scrinium

Self-hosted notes app. Notes are markdown files in a folder on the server, edited in the browser with an Obsidian-style live preview. Sign-in is Google OAuth, limited to the emails in `ALLOWED_EMAILS`.

## What it is

Every note is a `.md` file under `VAULT_DIR`. You can edit, back up, or move notes without the app. SQLite holds everything else: the search index, tasks, share links, sign-ins, and API tokens.

The editor is CodeMirror 6. It hides markdown syntax and shows it again on the line the cursor is on.

Notes you are done with can be archived from the note menu, the file tree, or the palette. Archived notes leave the tree and normal search but stay on disk under `.archive/` and are searchable from the Archive view (the box icon beside the trash). Emptying the trash never touches the archive. The Review tab lists stale notes (untouched for a while, nothing links to them, no task, share link or pin) to archive or trash in bulk. The Unused files tab lists attachments whose name no note mentions, to trash in bulk. Moving or renaming a note, folder or file rewrites the relative links that pointed through it, so images keep loading. Archiving a note removes its share links.

**Settings > Shared links** lists every public share link, grouped by note. From there you can copy a link, add, change or remove its password, revoke it, or open the note. New links are still made from a note's Share button.

A project is a folder at the vault root with its own notes, pins and board. Everything outside a project is Quotidian. The notes sidebar shows all projects as sections, or one project at a time from the switcher at its top, where search then stays inside that project. Pin a note in its project or everywhere. Make a project from the switcher, a right-click in the sidebar, the palette, or the + on the Board's tabs; any top-level folder can become one. The Board has a tab per project plus All and Quotidian. A project's Inbox is its backlog and stays on its own tab. Its tasks show on All and the task list once they move to This week or later.

## Getting started (local)

Copy `.env.example` to `.env` and fill it in:

```dotenv
VAULT_DIR=./vault
DATABASE_PATH=./data/scrinium.db
BETTER_AUTH_URL=http://localhost:5173
BETTER_AUTH_SECRET=<openssl rand -base64 32>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ALLOWED_EMAILS=you@gmail.com
```

Add `http://localhost:5173/api/auth/callback/google` to the redirect URIs of the Google OAuth client. Then start the app:

```bash
bun install
bun run dev
```

The app runs at `http://localhost:5173`. It creates the auth tables on first start.

## Connecting an agent

The MCP server is at `https://<your-host>/api/mcp`. Create a token in **Settings > Agents** and give the agent the URL and the header `Authorization: Bearer <token>`. Each token's **Activity** button lists the agent's changes from the last 30 days.

The server has these tools:

- Notes: `list_notes`, `search_notes`, `read_note`, `create_note`, `update_note`, `edit_note`, `append_to_note`, `move_note`, `create_folder`, `delete_note`, `list_trash`, `restore_from_trash`, `archive_note`, `list_archive`, `unarchive_note`, `share_note` (`search_notes` takes `include_archived`)
- Attachments: `upload_attachment`, `read_attachment`
- Tags and links: `list_tags`, `find_notes_by_tag`, `get_backlinks`
- Tasks: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `link_task_to_note`, `unlink_task_from_note`, `get_agenda`
- Projects: `list_projects`, `create_project`

## Deployment

Scrinium runs as one Node process behind Caddy. Build it with `bun run build`. The output goes to `build/`, and `node build/index.js` starts it.

`deploy/` has the systemd unit (`scrinium.service`), the Caddy config (`Caddyfile`), and a backup script (`backup.sh`). A push to `main` deploys through `.github/workflows/deploy.yml`.

