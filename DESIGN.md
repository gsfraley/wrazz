# wrazz — Design Document

wrazz is a self-hosted personal journal built around plain Markdown files.
Think of it as VSCode's artsy cousin: the same structural chrome — sidebar,
editor pane, status bar, command palette — but serif fonts, a warm paper-driven
editor space, and a focus on writing rather than coding.

This document describes the architecture, the decisions behind it, and where
the project is going. Read it before touching core code.

---

## Goals

- **Source-mode editing.** Markdown is always visible as written. No hidden
  syntax, no WYSIWYG rendering in the editor pane. What you type is what is stored.
- **Paper feel.** The editor should feel like writing, not like a developer tool.
  Variable fonts, warm palette, generous leading.
- **Extensible by design.** The architecture is shaped for extensions from day
  one. Hook points are named and reserved; filling them in is adding an
  implementation, not a refactor.
- **Self-hostable and local-first.** Runs on a home lab or a laptop with equal
  ease. No cloud dependency, no account required.
- **Open source (MIT).** Any fork is welcome.

---

## Module Layout

```
wrazz/
├── Cargo.toml                    # Cargo workspace root
└── modules/
    ├── wrazz-core/               # Shared domain types and Backend trait
    ├── wrazz-backend/            # File storage, LocalBackend, HttpBackend
    ├── wrazz-server/             # Multi-user server: auth, sessions, admin API
    ├── wrazz-editor/             # Standalone React/TS editor component (npm)
    └── wrazz-frontend/           # React/Vite single-page application
```

`wrazz-core` is the only module every other Rust crate depends on.
`wrazz-backend` provides the storage implementations consumed by `wrazz-server`.
`wrazz-frontend` is consumed by `wrazz-server` at build time; it is not a Rust crate.

### Dependency graph

```
wrazz-server  ──▶  wrazz-backend  ──▶  wrazz-core
wrazz-server  ──▶  wrazz-core
wrazz-frontend  ──(HTTP)──▶  wrazz-server
```

---

## Deployment Modes

### Server-only (current homelab deployment)

`wrazz-server` runs as a container. It serves the frontend from embedded static
assets and exposes the full authenticated API. External access is via the ingress.
This is the primary deployment target today.

```
browser  ──HTTP──▶  wrazz-server  ──▶  filesystem
```

### All-in-one (planned: desktop / local)

A single binary, no network involved. `LocalBackend` is injected directly;
the frontend is loaded from embedded assets. This is the foundation for the
Tauri desktop app. See issue #3.

```
wrazz-frontend (embedded webview)
      ↓
wrazz-server (in-process, LocalBackend)
      ↓
filesystem
```

### Client + remote server (planned: native app in remote mode)

The native client connects to a running `wrazz-server`. File operations go
over HTTP via `HttpBackend`. Auth uses the full OIDC PKCE flow with the
session token stored in the system keychain.

```
wrazz-frontend (embedded webview)
      ↓
wrazz-server (remote, HttpBackend)
      ↓
filesystem (on server)
```

---

## Domain Model

### File IDs

The file ID is the **full path relative to the workspace root**, including
extension and any directory segments.

- A file at `<workspace>/morning-pages.md` has path `/morning-pages.md`.
- A file at `<workspace>/journal/2026/april.md` has path `/journal/2026/april.md`.
- All API routes use `/`-prefixed paths: `GET /api/files/journal/2026/april.md`.

### Storage format

Each file is a single Markdown file. Front matter is minimal:

```markdown
---
title: "Morning Pages"
tags: ["journal"]
created_at: "2026-04-15T10:30:00Z"
---

Entry body in Markdown.
```

Only `title`, `tags` (omitted if empty), and `created_at` appear in front
matter. The path is not stored (it is the relative filesystem path). `updated_at`
is not stored (it is the filesystem mtime).

### Naked file support

Files with no front matter are fully supported. A human can write plain Markdown
in any editor, save it into a workspace directory, and wrazz picks it up:

```markdown
# Morning Pages

Just some thoughts.
```

`title` is taken from the first `# Heading` or the filename stem.
`created_at` and `updated_at` fall back to the file's mtime. `tags` is empty.

### Types (wrazz-core)

| Type | Fields | Notes |
|---|---|---|
| `FileEntry` | path, title, tags, created\_at, updated\_at | metadata only, no content |
| `DirEntry` | path, created\_at, updated\_at | |
| `Entry` | `File(FileEntry)` \| `Dir(DirEntry)` | returned by list |
| `FileContent` | content: String | fetched separately |

---

## Backend Trait

The `Backend` trait is the contract between `wrazz-server` and storage.
All methods take `workspace: &str` (UUID string) and `/`-prefixed `path: &str`.

```rust
list_entries(workspace, path)                         -> Vec<Entry>
get_file(workspace, path)                             -> FileEntry
get_file_content(workspace, path)                     -> FileContent
create_file(workspace, path, title, tags, content)    -> FileEntry
update_file(workspace, path, title, tags, content)    -> FileEntry
delete_entry(workspace, path)
create_dir(workspace, path)
move_entry(ws_from, path_from, ws_to, path_to)
```

Two implementations exist in `wrazz-backend`:

| Implementation | Used in | How |
|---|---|---|
| `LocalBackend` | All-in-one mode, standalone binary | Reads/writes filesystem directly |
| `HttpBackend` | Client in remote mode | REST calls to a remote server |

`wrazz-server` holds an `Arc<dyn Backend>` and is unaware of which it got.

---

## HTTP API

All routes require an authenticated session except the auth endpoints and
`GET /api/auth/oidc/status`.

### Files and directories

| Method | Path | Description |
|---|---|---|
| GET | `/api/entries?path=<path>` | List directory (depth-1) |
| DELETE | `/api/entries/{*path}` | Delete file or directory |
| PATCH | `/api/entries/{*path}` | Move/rename `{ to_path }` |
| GET | `/api/files/{*path}` | File metadata |
| GET | `/api/content/{*path}` | File content |
| POST | `/api/files/{*path}` | Create file `{ title, tags, content }` |
| PUT | `/api/files/{*path}` | Update file `{ title, tags, content }` |
| POST | `/api/dirs/{*path}` | Create directory |

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Password login `{ username, password }` |
| POST | `/api/auth/logout` | End session |
| GET | `/api/auth/oidc/redirect` | Begin OIDC authorization code flow |
| GET | `/api/auth/oidc/callback` | OIDC callback (redirect target) |
| GET | `/api/auth/oidc/status` | Whether OIDC is currently active (unauthenticated) |

### User

| Method | Path | Description |
|---|---|---|
| GET | `/api/user/self` | Current user record |
| PUT | `/api/user/self` | Update email `{ email }` |

### Admin (admin role required)

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/oidc` | OIDC config (secret redacted) |
| PUT | `/api/admin/oidc` | Save OIDC config and hot-swap provider |
| DELETE | `/api/admin/oidc` | Remove OIDC config |
| GET | `/api/admin/users` | List all users |
| DELETE | `/api/admin/users/{id}` | Delete user |

---

## Authentication

### Session model

Sessions are UUID tokens stored in SQLite with a Unix-timestamp expiry.
On login the token is set as an `HttpOnly` cookie (`wrazz_session`). The
`AuthUser` Axum extractor resolves the cookie to a live user on every
authenticated request.

Default session duration is one week (`WRAZZ_SESSION_HOURS`). For desktop
clients, this can be extended to two weeks or more.

### Password auth

Users are stored in `users`. Credentials live in a separate
`user_auth_providers` table (`provider = 'password'`, `subject = username`,
`credential_hash = argon2`). One user can have both password and OIDC rows.

Bootstrap: `WRAZZ_BOOTSTRAP_ADMIN=username:password` creates the first admin
on a fresh deployment if no admin exists yet.

### OIDC auth

Any OpenID Connect provider is supported (tested with Authentik). The flow
uses the authorization code grant with PKCE and a nonce.

OIDC configuration is managed at runtime via the admin UI and stored in
the `oidc_config` table. `WRAZZ_OIDC_*` environment variables override the
DB config at startup (useful for automated deployments).

**Account matching** in the callback (in order):

1. Match by `sub` claim → fast path, covers all logins after the first.
2. Match by `email` claim → first SSO login for an existing password account;
   on match, the OIDC sub is linked to the account so future logins hit path 1.
3. No match → 403. Auto-provisioning is disabled; accounts must be created by
   an admin and have an email set before SSO can be used.

### Env vars

| Variable | Default | Description |
|---|---|---|
| `WRAZZ_BOOTSTRAP_ADMIN` | — | `username:password` for first-run admin |
| `WRAZZ_SESSION_HOURS` | 168 (1 week) | Session lifetime |
| `WRAZZ_OIDC_ISSUER_URL` | — | Overrides DB OIDC config |
| `WRAZZ_OIDC_CLIENT_ID` | — | Overrides DB OIDC config |
| `WRAZZ_OIDC_CLIENT_SECRET` | — | Overrides DB OIDC config |
| `WRAZZ_OIDC_REDIRECT_URI` | — | Overrides DB OIDC config |
| `WRAZZ_PUBLIC_URL` | — | Base URL; used to compute suggested OIDC redirect URI |
| `WRAZZ_DATA_DIR` | `./data` | Filesystem root for user files |
| `WRAZZ_BIND` | `127.0.0.1:3001` | Listen address |
| `WRAZZ_STATIC_DIR` | — | Serve frontend from this path instead of embedded assets |

---

## Workspaces

### Current state

The `workspaces` table (`id TEXT`, `user_id`, `name`) exists. Each user gets
a default workspace created lazily on first file access. All Backend trait
methods take `workspace: &str`, and the API accepts `?workspace=<uuid>`, but
the workspace parameter is not yet used for filesystem routing — all files
for a user live under `<data_dir>/<user_id>/` regardless of workspace.

### Planned: full workspace support

The goal is for workspaces to be the primary organisational and sync unit:

**Filesystem migration**

Files will move from `<data_dir>/<user_id>/` to
`<data_dir>/<user_id>/<workspace_id>/`. This unlocks true workspace isolation
and is a prerequisite for everything below.

**Workspace CRUD API**

`GET/POST /api/workspaces`, `DELETE /api/workspaces/{id}`, etc. The switcher
in the frontend will list all workspaces for the current user and let you
create, rename, and delete them.

**Workspace switcher UI**

A picker sits above the file pane. Switching workspaces changes the file pane
root — the rest of the UI (editor, status bar) stays unchanged.

See issue #15.

---

## Native Client and Local Workspaces

### The workspace-as-sync-unit model

In the native client, workspaces come in two flavours:

- **Local workspace** — files live on the device's filesystem. `LocalBackend`
  handles all I/O in-process. No network required; no sync surface.
- **Remote workspace** — files live on a running `wrazz-server`. `HttpBackend`
  forwards operations over HTTP. Requires connectivity.

The user switches between workspaces in the picker. There is no automatic sync
between local and remote workspaces in v1 — data lives in one place and the
client is the window into it. This sidesteps the sync problem entirely.
Cached/offline remote workspaces are a future concern.

### Tauri

The native client is built with [Tauri 2](https://tauri.app), which supports
macOS, Linux, Windows, iOS, and Android from one codebase. The existing React
frontend runs in a WebView shell; the Rust backend logic runs in-process.

In local mode the Tauri app behaves as the all-in-one binary (issue #3) with a
native window wrapper, dock icon, and menu bar. In remote mode it connects to
a `wrazz-server` instance via `HttpBackend`.

See issue #16.

### Auth for native clients

Web sessions (cookie-based) do not translate cleanly to native apps. The native
client uses **OAuth2 PKCE** with the OIDC provider directly:

1. App opens the system browser to the Authentik authorization URL.
2. Authentik redirects to a custom URL scheme (`wrazz://auth/callback`).
3. App captures the callback, exchanges the code for an access token, stores it
   in the system keychain (macOS Keychain, iOS Keychain, Linux Secret Service).
4. Token is attached to all API requests as a `Bearer` header (requires a new
   token-based auth path on the server alongside the existing cookie path).
5. On expiry, the app re-challenges silently if possible; otherwise prompts.

Session duration for desktop clients can be extended (two weeks or more via
`WRAZZ_SESSION_HOURS`) without compromising the PKCE flow security model.

See issue #17.

### Remote workspace connection flow

Connecting a remote workspace from the native app:

1. User enters the server URL.
2. App discovers the OIDC config via `GET /api/auth/oidc/status` and initiates
   the PKCE flow described above.
3. On success, app calls `GET /api/workspaces` and presents the list.
4. Selected workspace is added to the local workspace list and persists across
   app restarts.

See issue #18.

### Editor on mobile

The `WrazzEditor` component uses `contenteditable`. On macOS WebView this is
fine. On iOS WKWebView, cursor placement, selection handles, and input method
behaviour have historically been buggy. This needs explicit testing before
committing to the Tauri mobile path; native UITextView-backed text editing is
the fallback if WKWebView proves unworkable.

---

## wrazz-editor

`modules/wrazz-editor/` is a separately publishable npm package consumed by
`wrazz-frontend` as a workspace dependency.

The editor is a `contenteditable` div with a custom modifier system. Each
modifier owns a regex pattern, an HTML renderer, and a markdown extractor.
The pipeline renders on every keystroke; caret position is saved before and
restored after the DOM update.

### Implemented modifiers

| Modifier | Markdown | Rendered as |
|---|---|---|
| Bold | `**text**` | `<strong>` with visible `**` marks |
| Italic | `*text*` | `<em>` with visible `*` marks |
| Link | `[text](url)` | styled span; link overlay on cursor entry |

### Remaining modifier work

Variable font support (weight/width axes so headings render heavier) and
additional modifiers (code spans, strikethrough, blockquotes) are not yet
implemented. See issue #1.

### Link overlay

When the cursor enters a complete `[text](url)` span, a floating overlay
appears above the link for editing. The dismissal logic (triggered by
`selectionchange`) has a timing bug: the overlay closes the moment the user
clicks into the input because `selectionchange` fires before focus transfers.
See issue #6.

---

## wrazz-frontend

React/Vite SPA. Runs in a browser or a Tauri WebView without modification.
Always talks HTTP to the server.

### Component tree

```
App
├── LoginPage              (shown when unauthenticated)
└── workspace
    ├── FileTree           (sidebar: lazy depth-1, rename, drag-and-drop)
    └── Editor
        ├── editor-header  (user menu → Profile / Administration / Sign out)
        ├── title input
        └── WrazzEditor    (from wrazz-editor)
    └── modals/
        ├── Modal          (base: backdrop, Escape, header)
        ├── ProfileModal   (display name, email, member since, role)
        └── AdminModal     (nav: Info | SSO | Users)
└── StatusBar
```

### Design language

wrazz is deliberately VSCode-shaped: sidebar on the left, editor pane in the
centre, status bar along the bottom. The structural chrome uses neutral
monospace/sans-serif density. The editor pane breaks from that completely —
serif fonts, warm paper-toned background (`--paper: #f5f0e8`), no gutter, no
line numbers.

### CSS palette

| Variable | Value | Use |
|---|---|---|
| `--paper` | `#f5f0e8` | Editor background |
| `--paper-sidebar` | `#f1ece3` | Sidebar background |
| `--paper-topbar` | `#e4dfd3` | Top bar background |
| `--ink` | `#1a1a18` | Primary text |
| `--ink-muted` | `#7a7a6e` | Secondary text, labels |
| `--border` | `#e0d9cc` | General dividers |
| `--border-strong` | `#c8c0b0` | Topbar chrome, prominent dividers |
| `--danger` | `#a03030` | Destructive actions |

---

## Extension System

The request lifecycle in `wrazz-backend` has named hook points reserved for a
future WASM/WASI extension host:

```
create / update:  load → [before_save] → write → [after_save] → respond
open:             load → [on_open] → respond
```

These are no-ops today. The host design (WIT interface, wasmtime) lives on the
`far-throw-initial-ai-generation` branch as a reference artefact. The
`gsfraley/wrazz-extensions` repo does not yet exist. See issue #2.

AI extensions (Claude integration) will live in `wrazz-extensions` and will
only have access to what the host explicitly grants. The core app will remain
free of API keys.

---

## What Is Not In This Repo

- **Extension machinery** — WASM runtime, WIT interface, extension loading.
- **AI / Claude integration** — will live in `gsfraley/wrazz-extensions`.
- **WYSIWYG / preview rendering** — not a goal; source mode only.
- **CodeMirror** — reserved for configuration editors, not the journal editor.
- **Tauri project** — will live here once scaffolded (issue #16).
