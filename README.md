# Scrinium

A lightweight, self-hosted, Obsidian-style notes app. SvelteKit + CodeMirror 6
live preview editor + plain markdown files on disk + Google-OAuth-gated login.
Built as **Phase 1** of a bigger plan: run this as a website today, wrap it
with `deno desktop` once that's stable, add a React Native mobile client
later. See the code comments in `src/lib/editor/livePreview.ts` for how the
live-preview rendering actually works.

## What's here

```
src/
  hooks.server.ts          <- the actual auth gate (redirects to /login)
  lib/
    server/
      auth.ts              <- Better Auth + Google OAuth + email allowlist
      db.ts                <- sqlite (sessions + note metadata cache)
      vault.ts              <- filesystem read/write, path-traversal safe
    editor/
      livePreview.ts        <- the live-preview decoration engine (read this one)
      markdownSetup.ts       <- CM6 language + theme
      CodeEditor.svelte     <- Svelte wrapper around the CM6 EditorView
    components/             <- Sidebar, FileTree, TopBar
    stores/vault.ts         <- client-side state + debounced autosave
  routes/
    +page.svelte            <- main app shell
    login/+page.svelte
    api/
      auth/[...all]/        <- Better Auth handler
      notes/[...path]/      <- note CRUD
      tree/                 <- vault listing for the sidebar
vault/notes/Welcome.md      <- a starter note (local dev only - see below)
deploy/
  Caddyfile                 <- reverse proxy + auto TLS config
  scrinium.service          <- systemd unit
  backup.sh                 <- cron-able nightly backup
```

## 1. Local setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `VAULT_DIR` - can point at the included `vault/` folder for local dev
- `BETTER_AUTH_SECRET` - generate with `openssl rand -base64 32`
- `BETTER_AUTH_URL` - `http://localhost:5173` for local dev
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - see step 2
- `ALLOWED_EMAILS` - your own email address(es), comma-separated
- `DATABASE_PATH` - e.g. `./data/scrinium.db`

Then create the auth tables (Better Auth ships a CLI for this):

```bash
npx @better-auth/cli migrate
```

Run it:

```bash
npm run dev
```

Visit `http://localhost:5173` - it'll bounce you to `/login`.

## 2. Google OAuth setup

1. Go to console.cloud.google.com → **APIs & Services → Credentials**.
2. Create an **OAuth client ID**, application type **Web application**.
3. Under **Authorized redirect URIs**, add:
   - `http://localhost:5173/api/auth/callback/google` (for local dev)
   - `https://scrinium.yourdomain.com/api/auth/callback/google` (for production)
4. Copy the generated Client ID and Client Secret into `.env`.
5. On the **OAuth consent screen** tab, you can leave it in "Testing" mode
   and just add your own email as a test user - you don't need to publish
   the app publicly since you're the only intended user.

**Why the `ALLOWED_EMAILS` check in `auth.ts` matters:** Google's consent
screen only proves *who* is signing in, not that they're allowed to use your
app. Once your subdomain is live, its DNS is public, so anyone could hit
"Continue with Google" with their own account. The `databaseHooks.user.create`
check in `src/lib/server/auth.ts` is what actually rejects everyone except
the addresses you list - don't remove it.

## 3. Deploying to your VPS

Assuming a fresh Ubuntu/Debian VPS with Node.js and Caddy already installed:

```bash
# On your VPS
sudo useradd -r -m -d /opt/scrinium scrinium
sudo mkdir -p /opt/scrinium/{app,vault,data,backups}
sudo chown -R scrinium:scrinium /opt/scrinium
```

From your machine, build and ship it:

```bash
npm run build
rsync -av --exclude node_modules --exclude .git \
  ./ scrinium@your-vps:/opt/scrinium/app/
```

On the VPS:

```bash
cd /opt/scrinium/app
npm install --omit=dev
cp .env.example .env   # then edit with production values:
                        #   VAULT_DIR=/opt/scrinium/vault
                        #   DATABASE_PATH=/opt/scrinium/data/scrinium.db
                        #   BETTER_AUTH_URL=https://scrinium.yourdomain.com
npx @better-auth/cli migrate
```

DNS: add an **A record** — `scrinium.yourdomain.com → <your VPS IP>`.

Caddy: append the contents of `deploy/Caddyfile` (with your real domain) to
`/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`. TLS is automatic.

systemd: copy `deploy/scrinium.service` to `/etc/systemd/system/`, adjust
paths if you didn't use `/opt/scrinium`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now scrinium
sudo systemctl status scrinium
```

Backups: add `deploy/backup.sh` to cron (`crontab -e` as the `scrinium`
user, or root with the paths adjusted) - it tars up the vault + db nightly
and prunes anything older than 14 days locally. Uncomment and configure the
`rsync` line to also copy backups off-box.

Visit `https://scrinium.yourdomain.com` and sign in.

## 4. What's intentionally NOT here

Per your "no fancy/useless stuff" brief, this skips: graph view, backlinks,
plugin marketplace, real-time collaboration, and mobile-specific UI. The
plugin API (for Todoist etc.), sync-to-desktop story (for the `deno desktop`
wrap later), and the React Native app are all separate next steps - the
architecture here (plain files, thin REST API, session-based auth) is set up
to support all three without a rewrite.

## 5. Known rough edges to expect

- `livePreview.ts` covers headings, bold/italic, inline code, links, and
  task checkboxes. It's a working MVP of the "hide marks unless cursor is on
  that line" pattern Obsidian uses, not a pixel-perfect clone - tables,
  nested lists, and block quotes will render as plain text for now. Extend
  `HIDEABLE_MARKS` / add new node-name cases in the same file to cover more.
- The note-metadata sqlite table is a cache, not a source of truth. If it
  ever drifts from what's on disk, it's safe to delete `data/scrinium.db`
  and re-run `migrate` - the vault's `.md` files are unaffected.
- No image/attachment upload endpoint yet - drop files directly into
  `vault/attachments/` for now and reference them with a relative markdown
  link; a proper upload endpoint is a small addition to
  `src/routes/api/notes/[...path]/+server.ts` when you want it.
