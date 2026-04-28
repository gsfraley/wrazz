-- Singleton row for admin-configured OIDC. CHECK (id = 1) enforces at most one row.
-- Env vars (WRAZZ_OIDC_*) take precedence over this table at startup; the admin UI
-- writes here at runtime so OIDC can be configured without a pod restart.
CREATE TABLE oidc_config (
    id            INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    issuer_url    TEXT    NOT NULL,
    client_id     TEXT    NOT NULL,
    client_secret TEXT    NOT NULL,
    redirect_uri  TEXT    NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1
);
