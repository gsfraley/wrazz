default:
    @just --list

# ── Build ─────────────────────────────────────────────────────────────────────

# Build everything: editor → frontend → server
build: build-editor build-frontend build-server build-desktop

build-webapp: build-editor build-frontend build-server

# Build the wrazz-editor library
build-editor:
    cd modules/wrazz-editor && yarn build

# Build the frontend SPA (requires editor dist)
build-frontend: build-editor
    cd modules/wrazz-frontend && yarn build

# Build the Rust server (and all workspace deps)
build-server:
    cargo build -p wrazz-server

# Build the Tauri desktop app (requires frontend dist)
build-desktop: build-frontend
    cd modules/wrazz-desktop && cargo tauri build

# ── Run ───────────────────────────────────────────────────────────────────────

# Run server + frontend dev in parallel
# Dev URL: http://localhost:5173  (Vite, HMR, proxies /api → :3001)
# API only: http://localhost:3001  (Rust, do not browse here directly)
run-webapp:
    #!/usr/bin/env bash
    trap 'kill 0' SIGINT SIGTERM
    just run-server &
    just run-frontend &
    wait

# Run the Vite dev server (editor source is live via alias — no build-editor needed)
run-frontend:
    cd modules/wrazz-frontend && yarn dev

# Run the Rust server with live reload (API only in dev — no static files)
# WRAZZ_DEV_FRONTEND tells /api/connect where to redirect for the connect page.
run-server:
    RUST_LOG=info WRAZZ_BOOTSTRAP_ADMIN=admin:secret WRAZZ_BIND=0.0.0.0:3001 WRAZZ_DEV_FRONTEND=http://localhost:5173 cargo watch -x 'run -p wrazz-server'

# Run the desktop app in dev mode (Vite HMR + Tauri window)
# App window opens pointing at the Vite dev server; no wrazz-server needed for local workspaces
run-desktop:
    #!/usr/bin/env bash
    trap 'kill 0' SIGINT SIGTERM
    just run-frontend &
    cd modules/wrazz-desktop && cargo tauri dev
    wait
