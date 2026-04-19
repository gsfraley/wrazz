# --- Frontend build stage ---
FROM node:22-slim AS frontend

WORKDIR /app/frontend
COPY modules/wrazz-frontend/package.json modules/wrazz-frontend/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY modules/wrazz-frontend/ .
RUN yarn build

# --- Backend build stage ---
FROM rust:slim AS builder

WORKDIR /app
COPY . .
RUN cargo build --release -p wrazz-server && \
    strip target/release/wrazz-server

# --- Runtime stage ---
FROM debian:bookworm-slim

# ca-certificates is needed for TLS connections at runtime
# (OIDC discovery, token exchange).
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/wrazz-server /usr/local/bin/wrazz-server
COPY --from=frontend /app/frontend/dist /app/dist

ENV WRAZZ_STATIC_DIR=/app/dist

EXPOSE 3001

CMD ["wrazz-server"]
