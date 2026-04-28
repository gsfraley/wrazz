//! Database query functions.
//!
//! All queries use the runtime `sqlx::query_as` API rather than the
//! compile-time `query!` macros, so no database URL is required at build time.
//!
//! UUID columns are stored as 16-byte BLOBs (sqlx default for SQLite).
//! Session expiry is stored as a Unix timestamp (INTEGER) to avoid
//! text-comparison ambiguity.

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

use wrazz_server::User;

// --- Workspace queries ---

/// Returns the default workspace ID for `user_id`, creating one if none exists.
///
/// The workspace ID is a UUID string. The filesystem directory for the workspace
/// is still `<data_dir>/<user_id>/` until the workspace layout migration is done.
pub async fn get_or_create_default_workspace(
    pool: &SqlitePool,
    user_id: Uuid,
) -> sqlx::Result<String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM workspaces WHERE user_id = ? LIMIT 1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if let Some((id,)) = row {
        return Ok(id);
    }

    let workspace_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO workspaces (id, user_id) VALUES (?, ?)")
        .bind(&workspace_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(workspace_id)
}

// Internal row type for queries that join users with auth providers.
#[derive(sqlx::FromRow)]
struct UserWithHash {
    id: Uuid,
    display_name: String,
    created_at: DateTime<Utc>,
    is_admin: bool,
    email: Option<String>,
    credential_hash: Option<String>,
}

// --- User queries ---

pub async fn get_user_by_id(pool: &SqlitePool, id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at, is_admin, email FROM users WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Returns `true` if at least one user with `is_admin = 1` exists.
/// Used at startup to decide whether to run the bootstrap.
pub async fn has_any_admin(pool: &SqlitePool) -> sqlx::Result<bool> {
    let row: (bool,) =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM users WHERE is_admin = 1)")
            .fetch_one(pool)
            .await?;
    Ok(row.0)
}

/// Looks up a user by their password login username and returns the user
/// together with their stored argon2 hash.
pub async fn get_user_by_password_subject(
    pool: &SqlitePool,
    username: &str,
) -> sqlx::Result<Option<(User, String)>> {
    let row = sqlx::query_as::<_, UserWithHash>(
        r#"
        SELECT u.id, u.display_name, u.created_at, u.is_admin, u.email, p.credential_hash
        FROM users u
        JOIN user_auth_providers p ON p.user_id = u.id
        WHERE p.provider = 'password' AND p.subject = ? AND p.credential_hash IS NOT NULL
        "#,
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;

    Ok(row.and_then(|r| {
        r.credential_hash.map(|hash| {
            (
                User {
                    id: r.id,
                    display_name: r.display_name,
                    created_at: r.created_at,
                    is_admin: r.is_admin,
                    email: r.email,
                },
                hash,
            )
        })
    }))
}

pub async fn get_user_by_oidc_subject(
    pool: &SqlitePool,
    sub: &str,
) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT u.id, u.display_name, u.created_at, u.is_admin, u.email
        FROM users u
        JOIN user_auth_providers p ON p.user_id = u.id
        WHERE p.provider = 'oidc' AND p.subject = ?
        "#,
    )
    .bind(sub)
    .fetch_optional(pool)
    .await
}

/// Looks up a user by their email address. Used as a fallback in the OIDC
/// callback to link a new OIDC sub to an existing password account.
pub async fn get_user_by_email(pool: &SqlitePool, email: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at, is_admin, email FROM users WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
}

/// Creates a new user and a `'password'` auth provider row in a single
/// transaction. Returns a conflict error if the username is already taken.
pub async fn create_user_with_password(
    pool: &SqlitePool,
    display_name: &str,
    username: &str,
    credential_hash: &str,
    is_admin: bool,
) -> sqlx::Result<User> {
    let user_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO users (id, display_name, is_admin) VALUES (?, ?, ?)",
    )
    .bind(user_id)
    .bind(display_name)
    .bind(is_admin)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO user_auth_providers (id, user_id, provider, subject, credential_hash) \
         VALUES (?, ?, 'password', ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(username)
    .bind(credential_hash)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Fetch back to pick up the server-side created_at default.
    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at, is_admin, email FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
}

/// Adds an OIDC auth provider row to an existing user. Called when the OIDC
/// callback matches an existing user by email rather than by sub claim —
/// subsequent logins will match by sub and skip the email lookup.
pub async fn link_oidc_to_user(pool: &SqlitePool, user_id: Uuid, sub: &str) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO user_auth_providers (id, user_id, provider, subject) VALUES (?, ?, 'oidc', ?)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(sub)
    .execute(pool)
    .await?;
    Ok(())
}

/// Sets or clears the email address on a user record.
pub async fn set_user_email(
    pool: &SqlitePool,
    user_id: Uuid,
    email: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE users SET email = ? WHERE id = ?")
        .bind(email)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Returns all users ordered by creation date ascending.
pub async fn list_users(pool: &SqlitePool) -> sqlx::Result<Vec<User>> {
    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at, is_admin, email FROM users ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await
}

/// Deletes a user and all cascading rows (sessions, auth providers, workspaces).
/// Files on disk are not removed.
pub async fn delete_user(pool: &SqlitePool, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// --- OIDC config queries ---

/// The persisted OIDC provider configuration. One optional row in `oidc_config`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OidcConfig {
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub enabled: bool,
}

pub async fn get_oidc_config(pool: &SqlitePool) -> sqlx::Result<Option<OidcConfig>> {
    sqlx::query_as::<_, OidcConfig>(
        "SELECT issuer_url, client_id, client_secret, redirect_uri, enabled \
         FROM oidc_config WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
}

pub async fn upsert_oidc_config(pool: &SqlitePool, config: &OidcConfig) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO oidc_config (id, issuer_url, client_id, client_secret, redirect_uri, enabled) \
         VALUES (1, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET \
           issuer_url    = excluded.issuer_url, \
           client_id     = excluded.client_id, \
           client_secret = excluded.client_secret, \
           redirect_uri  = excluded.redirect_uri, \
           enabled       = excluded.enabled",
    )
    .bind(&config.issuer_url)
    .bind(&config.client_id)
    .bind(&config.client_secret)
    .bind(&config.redirect_uri)
    .bind(config.enabled)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_oidc_config(pool: &SqlitePool) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM oidc_config WHERE id = 1")
        .execute(pool)
        .await?;
    Ok(())
}

// --- Session queries ---

/// Inserts a new session and returns its UUID. Expiry is stored as a Unix
/// timestamp so it can be compared directly with `unixepoch('now')`.
pub async fn create_session(
    pool: &SqlitePool,
    user_id: Uuid,
    duration: chrono::Duration,
) -> sqlx::Result<Uuid> {
    let session_id = Uuid::new_v4();
    let expires_at = (Utc::now() + duration).timestamp();

    sqlx::query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(session_id)
}

/// Resolves a session cookie to a live user. Returns `None` if the session
/// does not exist or has expired.
pub async fn get_session_user(pool: &SqlitePool, session_id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT u.id, u.display_name, u.created_at, u.is_admin, u.email
        FROM users u
        JOIN sessions s ON s.user_id = u.id
        WHERE s.id = ? AND s.expires_at > unixepoch('now')
        "#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_session(pool: &SqlitePool, session_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Deletes all expired sessions. Returns the number of rows removed.
pub async fn delete_expired_sessions(pool: &SqlitePool) -> sqlx::Result<u64> {
    let r = sqlx::query("DELETE FROM sessions WHERE expires_at <= unixepoch('now')")
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
