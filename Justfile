default:
    @just --list

# ── Build ─────────────────────────────────────────────────────────────────────

# Build everything: editor → frontend → server
build: build-editor build-frontend build-server

# Build the wrazz-editor library
build-editor:
    cd modules/wrazz-editor && yarn build

# Build the frontend SPA (requires editor dist)
build-frontend: build-editor
    cd modules/wrazz-frontend && yarn build

# Build the Rust server (and all workspace deps)
build-server:
    cargo build -p wrazz-server

# ── Run ───────────────────────────────────────────────────────────────────────

# Run server + frontend dev in parallel
# Dev URL: http://localhost:5173  (Vite, HMR, proxies /api → :3001)
# API only: http://localhost:3001  (Rust, do not browse here directly)
run:
    #!/usr/bin/env bash
    trap 'kill 0' SIGINT SIGTERM
    just run-server &
    just run-frontend &
    wait

# Run the Rust server with live reload (API only in dev — no static files)
run-server:
    RUST_LOG=info WRAZZ_BOOTSTRAP_ADMIN=admin:secret WRAZZ_BIND=0.0.0.0:3001 cargo watch -x 'run -p wrazz-server'

# Run the Vite dev server (editor source is live via alias — no build-editor needed)
run-frontend:
    cd modules/wrazz-frontend && yarn dev
