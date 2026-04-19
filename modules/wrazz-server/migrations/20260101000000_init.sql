CREATE TABLE users (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (user, auth method). A user can have both 'password' and 'oidc'
-- rows at the same time; they share the same users.id and therefore the same
-- journal workspace.
CREATE TABLE user_auth_providers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        TEXT        NOT NULL,  -- 'password' | 'oidc'
    subject         TEXT        NOT NULL,  -- username or OIDC sub claim
    credential_hash TEXT,                 -- argon2 hash; NULL for oidc rows
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(provider, subject)
);

CREATE TABLE sessions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
