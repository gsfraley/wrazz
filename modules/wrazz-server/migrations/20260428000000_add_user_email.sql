ALTER TABLE users ADD COLUMN email TEXT;

-- Partial unique index so NULL emails don't conflict with each other.
CREATE UNIQUE INDEX users_email_idx ON users(email) WHERE email IS NOT NULL;
