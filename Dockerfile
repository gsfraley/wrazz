# --- Build stage ---
FROM rust:slim AS builder

WORKDIR /app
COPY . .
RUN cargo build --release -p wrazz-server && \
    strip target/release/wrazz-server

# --- Runtime stage ---
FROM debian:bookworm-slim

# ca-certificates is needed for TLS connections made at runtime
# (OIDC discovery, token exchange).
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/wrazz-server /usr/local/bin/wrazz-server

EXPOSE 3001

CMD ["wrazz-server"]
