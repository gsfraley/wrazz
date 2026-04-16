<img src="icon-wip.svg" width="64" align="left" style="margin-right: 16px">

# wrazz

A local-first writing app for notes and journaling. Plain Markdown files on disk, a clean paper-feel editor in the browser.

<br clear="left">

---

## What it is

wrazz stores everything as Markdown files in a directory you point it at. No database, no sync service, no account — just `.md` files with a bit of front matter for title and tags. Open the app, write, close the app. Your files are yours.

The interface is VSCode's artsy cousin: same structural chrome (file sidebar, status bar), but serif fonts and a warm paper palette instead of a code editor aesthetic.

## Architecture

Three layers, each with a clear job:

| Module | Role |
|---|---|
| `wrazz-core` | Shared types (`FileEntry`) and the `Backend` trait |
| `wrazz-backend` | File I/O + Axum HTTP server |
| `wrazz-midend` | BFF proxy layer — bridges the frontend to a local or remote backend |
| `wrazz-frontend` | React/Vite SPA — the editor UI |

`wrazz-backend` can run standalone as a server, or be embedded directly into a future desktop binary — the `Backend` trait abstracts over both modes.

## Running locally

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

Environment variables for the backend:

| Variable | Default | Description |
|---|---|---|
| `WRAZZ_DATA_DIR` | `./data` | Directory to read/write Markdown files |
| `WRAZZ_BIND` | `127.0.0.1:3000` | Address and port to listen on |

## Status

Early development. Core CRUD works end-to-end. A lot of the good stuff (tags UI, keyboard shortcuts, desktop packaging) is still ahead.
