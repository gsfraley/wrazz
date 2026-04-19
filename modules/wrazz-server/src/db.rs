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
    credential_hash: Option<String>,
}

// --- User queries ---

pub async fn get_user_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Returns `(user, credential_hash)` for password authentication.
pub async fn get_user_by_password_subject(
    pool: &PgPool,
    username: &str,
) -> sqlx::Result<Option<(User, String)>> {
    let row = sqlx::query_as::<_, UserWithHash>(
        r#"
        SELECT u.id, u.display_name, u.created_at, p.credential_hash
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
        SELECT u.id, u.display_name, u.created_at
        FROM users u
        JOIN user_auth_providers p ON p.user_id = u.id
        WHERE p.provider = 'oidc' AND p.subject = $1
        "#,
    )
    .bind(sub)
    .fetch_optional(pool)
    .await
}

pub async fn create_user_with_password(
    pool: &PgPool,
    display_name: &str,
    username: &str,
    credential_hash: &str,
) -> sqlx::Result<User> {
    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (display_name) VALUES ($1) RETURNING id, display_name, created_at",
    )
    .bind(display_name)
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

pub async fn create_user_with_oidc(
    pool: &PgPool,
    display_name: &str,
    sub: &str,
) -> sqlx::Result<User> {
    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (display_name) VALUES ($1) RETURNING id, display_name, created_at",
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

pub async fn get_session_user(pool: &PgPool, session_id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT u.id, u.display_name, u.created_at
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

pub async fn delete_expired_sessions(pool: &PgPool) -> sqlx::Result<u64> {
    let r = sqlx::query("DELETE FROM sessions WHERE expires_at <= now()")
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
