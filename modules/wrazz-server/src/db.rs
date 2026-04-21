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
    credential_hash: Option<String>,
}

// --- User queries ---

pub async fn get_user_by_id(pool: &SqlitePool, id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at, is_admin FROM users WHERE id = ?",
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
        SELECT u.id, u.display_name, u.created_at, u.is_admin, p.credential_hash
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
        SELECT u.id, u.display_name, u.created_at, u.is_admin
        FROM users u
        JOIN user_auth_providers p ON p.user_id = u.id
        WHERE p.provider = 'oidc' AND p.subject = ?
        "#,
    )
    .bind(sub)
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
        "SELECT id, display_name, created_at, is_admin FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
}

/// Creates a new user and an `'oidc'` auth provider row in a single
/// transaction. Called during OIDC callback when no existing user matches the
/// provider's `sub` claim (auto-provisioning).
pub async fn create_user_with_oidc(
    pool: &SqlitePool,
    display_name: &str,
    sub: &str,
) -> sqlx::Result<User> {
    let user_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO users (id, display_name) VALUES (?, ?)",
    )
    .bind(user_id)
    .bind(display_name)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO user_auth_providers (id, user_id, provider, subject) VALUES (?, ?, 'oidc', ?)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(sub)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at, is_admin FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
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
        SELECT u.id, u.display_name, u.created_at, u.is_admin
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
