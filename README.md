<img src="icon.svg" width="64" align="left" style="margin-right: 16px">

# wrazz

A local-first writing app for notes and journaling. Plain Markdown files on disk, a clean paper-feel editor in the browser.

<br clear="left">

---

## What it is

wrazz stores everything as Markdown files in a directory you point it at. No sync service, no account required for local use — just `.md` files with a bit of front matter for title and tags. Open the app, write, close the app. Your files are yours.

The interface is VSCode's artsy cousin: same structural chrome (file sidebar, status bar), but serif fonts and a warm paper palette instead of a code editor aesthetic.

In multi-user server mode, each user gets their own isolated directory and logs in with a password or via OIDC (Authentik or any other provider).

## Architecture

| Module | Role |
|---|---|
| `wrazz-core` | Shared types (`FileEntry`) and the `Backend` trait |
| `wrazz-backend` | File I/O layer (`Store`, `LocalBackend`, `HttpBackend`) + BFF binary |
| `wrazz-server` | Multi-user server binary — Postgres, sessions, auth, per-user file routing |
| `wrazz-frontend` | React/Vite SPA — the editor UI |

### Deployment modes

| Mode | What runs |
|---|---|
| Personal desktop | `wrazz-backend` in local mode (embeds `LocalBackend`, no separate process) |
| Self-hosted single-user | `wrazz-backend` proxying to a separate storage process |
| Self-hosted multi-user | `wrazz-server` + Postgres, `wrazz-backend` as the frontend BFF |

## Running locally (single-user)

**Backend** (defaults to `./data` and `127.0.0.1:3000`):

```
cargo run -p wrazz-backend
```

**Frontend dev server** (proxies `/api` to `localhost:3000`):

```
cd modules/wrazz-frontend
yarn install
yarn dev
```

Then open `http://localhost:5173`.

### Environment variables — wrazz-backend

| Variable | Default | Description |
|---|---|---|
| `WRAZZ_DATA_DIR` | `./data` | Directory to read/write Markdown files |
| `WRAZZ_BIND` | `127.0.0.1:3000` | Address and port to listen on |
| `WRAZZ_BACKEND_URL` | _(unset)_ | If set, proxy to a remote backend at this URL instead of using local files |

## Running the multi-user server

```
DATABASE_URL=postgres://... cargo run -p wrazz-server
```

Migrations run automatically on startup. Each user's files are stored under `WRAZZ_DATA_DIR/<user-uuid>/`.

### Environment variables — wrazz-server

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | _(required)_ | Postgres connection string |
| `WRAZZ_DATA_DIR` | `./data` | Root directory for per-user file trees |
| `WRAZZ_BIND` | `127.0.0.1:3001` | Address and port to listen on |
| `WRAZZ_SESSION_HOURS` | `168` (1 week) | Session lifetime in hours |
| `WRAZZ_OIDC_ISSUER_URL` | _(unset)_ | OIDC provider issuer URL (e.g. Authentik) |
| `WRAZZ_OIDC_CLIENT_ID` | _(unset)_ | OIDC client ID |
| `WRAZZ_OIDC_CLIENT_SECRET` | _(unset)_ | OIDC client secret |
| `WRAZZ_OIDC_REDIRECT_URI` | _(unset)_ | Callback URI registered with your OIDC provider |

OIDC is optional — if none of the `WRAZZ_OIDC_*` vars are set, password login still works.

## API surface

```
POST   /api/auth/register         create account (username + password)
POST   /api/auth/login            password login → session cookie
POST   /api/auth/logout           clear session
GET    /api/auth/me               current user info
GET    /api/auth/oidc/redirect    begin OIDC flow
GET    /api/auth/oidc/callback    OIDC provider posts back here

GET    /api/files                 list files (server: user-scoped)
POST   /api/files                 create file
GET    /api/files/{id}            get file
PUT    /api/files/{id}            update file
DELETE /api/files/{id}            delete file
```

## Status

Early development. Core CRUD works end-to-end. Auth layer is implemented but not yet wired into the frontend. A lot of the good stuff (tags UI, keyboard shortcuts, desktop packaging) is still ahead.
