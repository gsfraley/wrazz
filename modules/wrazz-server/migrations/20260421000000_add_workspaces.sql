-- Each user gets one default workspace. Additional workspaces are a future feature.
-- id is stored as TEXT (UUID string) per the all-string UUID policy for new entities.
-- user_id stays BLOB to match the existing users table schema.
CREATE TABLE workspaces (
    id         TEXT NOT NULL PRIMARY KEY,  -- UUID as string
    user_id    BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT 'default',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX workspaces_user_id_idx ON workspaces(user_id);
