//! Database query functions.
//!
//! All queries use the runtime `sqlx::query_as` API rather than the
//! compile-time `query!` macros, so no `DATABASE_URL` is required at build
//! time. Type correctness is checked at runtime on first execution instead.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use wrazz_server::User;

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

pub async fn get_user_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at, is_admin FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Returns `true` if at least one user with `is_admin = true` exists.
/// Used at startup to decide whether to run the bootstrap.
pub async fn has_any_admin(pool: &PgPool) -> sqlx::Result<bool> {
    let row: (bool,) =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM users WHERE is_admin = true)")
            .fetch_one(pool)
            .await?;
    Ok(row.0)
}

/// Looks up a user by their password login username and returns the user
/// together with their stored argon2 hash, so the caller can verify the
/// supplied password before creating a session.
pub async fn get_user_by_password_subject(
    pool: &PgPool,
    username: &str,
) -> sqlx::Result<Option<(User, String)>> {
    let row = sqlx::query_as::<_, UserWithHash>(
        r#"
        SELECT u.id, u.display_name, u.created_at, u.is_admin, p.credential_hash
        FROM users u
        JOIN user_auth_providers p ON p.user_id = u.id
        WHERE p.provider = 'password' AND p.subject = $1 AND p.credential_hash IS NOT NULL
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
    pool: &PgPool,
    sub: &str,
) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT u.id, u.display_name, u.created_at, u.is_admin
        FROM users u
        JOIN user_auth_providers p ON p.user_id = u.id
        WHERE p.provider = 'oidc' AND p.subject = $1
        "#,
    )
    .bind(sub)
    .fetch_optional(pool)
    .await
}

/// Creates a new user and a `'password'` auth provider row in a single
/// transaction. Returns a conflict error (propagated from the DB unique
/// constraint on `(provider, subject)`) if the username is already taken.
///
/// Pass `is_admin: true` only for the bootstrap path; normal user creation
/// always passes `false`.
pub async fn create_user_with_password(
    pool: &PgPool,
    display_name: &str,
    username: &str,
    credential_hash: &str,
    is_admin: bool,
) -> sqlx::Result<User> {
    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (display_name, is_admin) VALUES ($1, $2) \
         RETURNING id, display_name, created_at, is_admin",
    )
    .bind(display_name)
    .bind(is_admin)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO user_auth_providers (user_id, provider, subject, credential_hash) \
         VALUES ($1, 'password', $2, $3)",
    )
    .bind(user.id)
    .bind(username)
    .bind(credential_hash)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(user)
}

/// Creates a new user and an `'oidc'` auth provider row in a single
/// transaction. Called during OIDC callback when no existing user matches the
/// provider's `sub` claim (auto-provisioning).
pub async fn create_user_with_oidc(
    pool: &PgPool,
    display_name: &str,
    sub: &str,
) -> sqlx::Result<User> {
    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (display_name) VALUES ($1) \
         RETURNING id, display_name, created_at, is_admin",
    )
    .bind(display_name)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO user_auth_providers (user_id, provider, subject) VALUES ($1, 'oidc', $2)",
    )
    .bind(user.id)
    .bind(sub)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(user)
}

// --- Session queries ---

/// Inserts a new session row and returns its UUID. The session ID is generated
/// here rather than by the DB so the caller has it immediately without a
/// round-trip to read the default value back.
pub async fn create_session(
    pool: &PgPool,
    user_id: Uuid,
    duration: chrono::Duration,
) -> sqlx::Result<Uuid> {
    let session_id = Uuid::new_v4();
    let expires_at = Utc::now() + duration;

    sqlx::query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(session_id)
}

/// Resolves a session cookie value to a live user. Returns `None` if the
/// session does not exist or has expired (`expires_at <= now()`).
pub async fn get_session_user(pool: &PgPool, session_id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT u.id, u.display_name, u.created_at, u.is_admin
        FROM users u
        JOIN sessions s ON s.user_id = u.id
        WHERE s.id = $1 AND s.expires_at > now()
        "#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_session(pool: &PgPool, session_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Deletes all expired sessions in one shot. Called by the hourly background
/// task; returns the number of rows removed for logging.
pub async fn delete_expired_sessions(pool: &PgPool) -> sqlx::Result<u64> {
    let r = sqlx::query("DELETE FROM sessions WHERE expires_at <= now()")
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
