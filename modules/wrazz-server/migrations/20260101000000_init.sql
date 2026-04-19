CREATE TABLE users (
    id           BLOB NOT NULL PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One row per (user, auth method). A user can have both 'password' and 'oidc'
-- rows at the same time; they share the same users.id and therefore the same
-- journal workspace.
CREATE TABLE user_auth_providers (
    id              BLOB NOT NULL PRIMARY KEY,
    user_id         BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,  -- 'password' | 'oidc'
    subject         TEXT NOT NULL,  -- username or OIDC sub claim
    credential_hash TEXT,           -- argon2 hash; NULL for oidc rows
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(provider, subject)
);

CREATE TABLE sessions (
    id         BLOB    NOT NULL PRIMARY KEY,
    user_id    BLOB    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at INTEGER NOT NULL  -- Unix timestamp (seconds since epoch)
);

CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
