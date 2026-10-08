# Scrinium

Self-hosted notes app. Notes are markdown files in a folder on the server, edited in the browser with an Obsidian-style live preview. Sign-in is Google OAuth, limited to the emails in `ALLOWED_EMAILS`.

## What it is

Every note is a `.md` file under `VAULT_DIR`. You can edit, back up, or move notes without the app. SQLite holds everything else: the search index, tasks, share links, sign-ins, and API tokens.

The editor is CodeMirror 6. It hides markdown syntax and shows it again on the line the cursor is on.

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

- Notes: `list_notes`, `search_notes`, `read_note`, `create_note`, `update_note`, `edit_note`, `append_to_note`, `move_note`, `create_folder`, `delete_note`, `list_trash`, `restore_from_trash`, `share_note`
- Attachments: `upload_attachment`, `read_attachment`
- Tags and links: `list_tags`, `find_notes_by_tag`, `get_backlinks`
- Tasks: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `link_task_to_note`, `unlink_task_from_note`, `get_agenda`

## Deployment

Scrinium runs as one Node process behind Caddy. Build it with `bun run build`. The output goes to `build/`, and `node build/index.js` starts it.

`deploy/` has the systemd unit (`scrinium.service`), the Caddy config (`Caddyfile`), and a backup script (`backup.sh`). A push to `main` deploys through `.github/workflows/deploy.yml`.

