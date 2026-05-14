CREATE TABLE api_tokens (
    id           TEXT    NOT NULL PRIMARY KEY,
    user_id      BLOB    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL,
    scopes       TEXT    NOT NULL DEFAULT '["workspace/*"]',
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used_at TEXT
);
