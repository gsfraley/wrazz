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
use wrazz_core::WorkspaceSummary;

use crate::User;

// --- Workspace queries ---

/// Returns all workspaces owned by `user_id`, ordered by creation date.
pub async fn list_workspaces(
    pool: &SqlitePool,
    user_id: Uuid,
) -> sqlx::Result<Vec<WorkspaceSummary>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, name FROM workspaces WHERE user_id = ? ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, name)| WorkspaceSummary { id, name }).collect())
}

/// Returns a single workspace if it exists and is owned by `user_id`.
pub async fn get_workspace(
    pool: &SqlitePool,
    workspace_id: &str,
    user_id: Uuid,
) -> sqlx::Result<Option<WorkspaceSummary>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, name FROM workspaces WHERE id = ? AND user_id = ?",
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, name)| WorkspaceSummary { id, name }))
}

/// Creates a new workspace for `user_id` and returns its summary.
pub async fn create_workspace(
    pool: &SqlitePool,
    user_id: Uuid,
    name: &str,
) -> sqlx::Result<WorkspaceSummary> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO workspaces (id, user_id, name) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(user_id)
        .bind(name)
        .execute(pool)
        .await?;

    Ok(WorkspaceSummary { id, name: name.to_string() })
}

/// Renames `workspace_id` if it belongs to `user_id`.
/// Returns `true` if a row was updated.
pub async fn rename_workspace(
    pool: &SqlitePool,
    workspace_id: &str,
    user_id: Uuid,
    new_name: &str,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE workspaces SET name = ? WHERE id = ? AND user_id = ?",
    )
    .bind(new_name)
    .bind(workspace_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Deletes `workspace_id` if it belongs to `user_id`.
/// Returns `true` if a row was deleted.
pub async fn delete_workspace(
    pool: &SqlitePool,
    workspace_id: &str,
    user_id: Uuid,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "DELETE FROM workspaces WHERE id = ? AND user_id = ?",
    )
    .bind(workspace_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Returns the default workspace ID for `user_id`, creating one if none exists.
/// Used by the filesystem migration to ensure every user has a workspace row.
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
    sqlx::query("INSERT INTO workspaces (id, user_id, name) VALUES (?, ?, 'Workspace')")
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

// --- API token queries ---

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ApiTokenRow {
    pub id: String,
    pub user_id: Uuid,
    pub name: String,
    pub token_hash: String,
    pub scopes: String, // JSON array string
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Creates a new API token row and returns it. The caller is responsible for
/// passing an already-hashed token string; the raw token is never stored.
pub async fn create_api_token(
    pool: &SqlitePool,
    user_id: Uuid,
    name: &str,
    token_hash: &str,
    scopes: &[String],
) -> sqlx::Result<ApiTokenRow> {
    let id = Uuid::new_v4().to_string();
    let scopes_json =
        serde_json::to_string(scopes).unwrap_or_else(|_| r#"["workspace/*"]"#.to_string());
    sqlx::query(
        "INSERT INTO api_tokens (id, user_id, name, token_hash, scopes) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(name)
    .bind(token_hash)
    .bind(&scopes_json)
    .execute(pool)
    .await?;

    get_api_token_by_id(pool, &id)
        .await
        .map(|r| r.expect("just inserted"))
}

pub async fn get_api_token_by_id(
    pool: &SqlitePool,
    id: &str,
) -> sqlx::Result<Option<ApiTokenRow>> {
    sqlx::query_as::<_, ApiTokenRow>(
        "SELECT id, user_id, name, token_hash, scopes, created_at, last_used_at \
         FROM api_tokens WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Finds an API token by matching the raw token against stored hashes.
/// Updates `last_used_at` on a hit. Returns `None` if no match is found.
///
/// Fetches all token rows joined with their owner and verifies with argon2 in
/// Rust. Token counts are small (typically <10 per user) so this is fine.
pub async fn find_api_token_by_raw(
    pool: &SqlitePool,
    raw_token: &str,
) -> sqlx::Result<Option<(ApiTokenRow, User)>> {
    // Internal join row — only used inside this function.
    #[derive(sqlx::FromRow)]
    struct TokenWithUser {
        // token fields
        id: String,
        user_id: Uuid,
        name: String,
        token_hash: String,
        scopes: String,
        created_at: DateTime<Utc>,
        last_used_at: Option<DateTime<Utc>>,
        // user fields (aliased to avoid collision with token.id)
        uid: Uuid,
        display_name: String,
        ucreated_at: DateTime<Utc>,
        is_admin: bool,
        email: Option<String>,
    }

    let rows = sqlx::query_as::<_, TokenWithUser>(
        r#"SELECT t.id, t.user_id, t.name, t.token_hash, t.scopes,
                  t.created_at, t.last_used_at,
                  u.id AS uid, u.display_name, u.created_at AS ucreated_at,
                  u.is_admin, u.email
           FROM api_tokens t
           JOIN users u ON u.id = t.user_id"#,
    )
    .fetch_all(pool)
    .await?;

    for row in rows {
        let parsed = match argon2::PasswordHash::new(&row.token_hash) {
            Ok(h) => h,
            Err(_) => continue,
        };
        use argon2::PasswordVerifier;
        if argon2::Argon2::default()
            .verify_password(raw_token.as_bytes(), &parsed)
            .is_ok()
        {
            // Touch last_used_at — best-effort, ignore errors.
            let _ = sqlx::query(
                "UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
                 WHERE id = ?",
            )
            .bind(&row.id)
            .execute(pool)
            .await;

            let token_row = ApiTokenRow {
                id: row.id,
                user_id: row.user_id,
                name: row.name,
                token_hash: row.token_hash,
                scopes: row.scopes,
                created_at: row.created_at,
                last_used_at: row.last_used_at,
            };
            let user = User {
                id: row.uid,
                display_name: row.display_name,
                created_at: row.ucreated_at,
                is_admin: row.is_admin,
                email: row.email,
            };
            return Ok(Some((token_row, user)));
        }
    }

    Ok(None)
}

pub async fn list_api_tokens_for_user(
    pool: &SqlitePool,
    user_id: Uuid,
) -> sqlx::Result<Vec<ApiTokenRow>> {
    sqlx::query_as::<_, ApiTokenRow>(
        "SELECT id, user_id, name, token_hash, scopes, created_at, last_used_at \
         FROM api_tokens WHERE user_id = ? ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn delete_api_token(
    pool: &SqlitePool,
    id: &str,
    user_id: Uuid,
) -> sqlx::Result<bool> {
    let r = sqlx::query("DELETE FROM api_tokens WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}
