//! API token management endpoints.
//!
//! Routes:
//! - `GET  /api/connect`    — redirect to frontend connect/approve page
//! - `POST /api/connect`    — approve and issue a token (session auth)
//! - `GET  /api/tokens`     — list tokens for the current user (session auth)
//! - `DELETE /api/tokens/{id}` — delete a token (session auth)

use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};
use axum_extra::extract::cookie::CookieJar;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::auth::{AuthSource, AuthUser, SESSION_COOKIE};
use crate::{db, state::AppState};

// ---------------------------------------------------------------------------
// Query / body types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ConnectQuery {
    /// Human-readable name for the token (e.g. "Greg's MacBook").
    pub name: String,
    /// Must start with `http://127.0.0.1:`.
    pub redirect_uri: String,
    /// CSRF nonce supplied by the client.
    pub state: String,
    /// Optional comma-separated workspace UUIDs to pre-select.
    #[serde(default)]
    pub workspaces: String,
}

#[derive(Deserialize)]
pub struct ConnectForm {
    pub name: String,
    pub redirect_uri: String,
    pub state: String,
    /// Comma-separated workspace UUIDs, or `*` / `all` for all workspaces.
    pub workspaces: String,
}

// ---------------------------------------------------------------------------
// Token list response (never includes token_hash)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ConnectResult {
    callback_url: String,
}

#[derive(Serialize)]
pub struct TokenSummary {
    pub id: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn validate_redirect_uri(uri: &str) -> bool {
    uri.starts_with("http://127.0.0.1:")
}

/// Generates a 32-byte cryptographically random token and hex-encodes it.
fn generate_raw_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Hash `raw` with Argon2 (same algorithm used for passwords).
fn hash_token(raw: &str) -> Result<String, (StatusCode, &'static str)> {
    let salt = SaltString::generate(&mut rand::rngs::OsRng);
    Argon2::default()
        .hash_password(raw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "token hashing failed"))
}

/// Build the scope list from the `workspaces` field of a connect form.
fn build_scopes(workspaces: &str) -> Vec<String> {
    let trimmed = workspaces.trim();
    if trimmed.is_empty() || trimmed == "*" || trimmed == "all" {
        return vec!["workspace/*".to_string()];
    }
    trimmed
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|id| format!("workspace/{id}"))
        .collect()
}

/// Extract scopes that are per-workspace (not the wildcard), returning the
/// UUID portion of each scope for inclusion in the redirect query string.
fn scope_workspace_ids(scopes: &[String]) -> String {
    if scopes.iter().any(|s| s == "workspace/*") {
        return "*".to_string();
    }
    scopes
        .iter()
        .filter_map(|s| s.strip_prefix("workspace/"))
        .collect::<Vec<_>>()
        .join(",")
}

/// Try to extract the session user from the cookie jar without going through
/// the full `AuthUser` extractor (which also accepts Bearer tokens — we only
/// want human sessions here).
async fn session_user_only(
    jar: &CookieJar,
    pool: &sqlx::SqlitePool,
) -> Option<crate::User> {
    let session_id = jar
        .get(SESSION_COOKIE)
        .and_then(|c| Uuid::parse_str(c.value()).ok())?;
    db::get_session_user(pool, session_id).await.ok()?
}

// ---------------------------------------------------------------------------
// GET /api/connect — redirect to the frontend connect/approve page
// ---------------------------------------------------------------------------

pub async fn connect_approval_page(
    State(state): State<AppState>,
    Query(params): Query<ConnectQuery>,
) -> Response {
    if !validate_redirect_uri(&params.redirect_uri) {
        return (
            StatusCode::BAD_REQUEST,
            "redirect_uri must start with http://127.0.0.1:",
        )
            .into_response();
    }

    let query = format!(
        "name={}&redirect_uri={}&state={}&workspaces={}",
        url_encode(&params.name),
        url_encode(&params.redirect_uri),
        url_encode(&params.state),
        url_encode(&params.workspaces),
    );

    // In dev mode, the frontend is served by Vite on a different port, so we
    // redirect to the configured dev origin.  In production the static file
    // fallback serves /connect from the same origin.
    let location = match &state.dev_frontend {
        Some(dev) => format!("{dev}/connect?{query}"),
        None => format!("/connect?{query}"),
    };

    Redirect::to(&location).into_response()
}

// ---------------------------------------------------------------------------
// POST /api/connect — form submit, issue token, redirect
// ---------------------------------------------------------------------------

pub async fn connect_submit(
    State(state): State<AppState>,
    jar: CookieJar,
    axum::Form(form): axum::Form<ConnectForm>,
) -> Response {
    // Session-only — no Bearer tokens on the human flow.
    let user = match session_user_only(&jar, &state.pool).await {
        Some(u) => u,
        None => return (StatusCode::UNAUTHORIZED, "login required").into_response(),
    };

    if !validate_redirect_uri(&form.redirect_uri) {
        return (
            StatusCode::BAD_REQUEST,
            "redirect_uri must start with http://127.0.0.1:",
        )
            .into_response();
    }

    let raw_token = generate_raw_token();
    let token_hash = match hash_token(&raw_token) {
        Ok(h) => h,
        Err(e) => return e.into_response(),
    };

    let scopes = build_scopes(&form.workspaces);
    let workspace_param = scope_workspace_ids(&scopes);

    let _token_row =
        match db::create_api_token(&state.pool, user.id, &form.name, &token_hash, &scopes).await {
            Ok(r) => r,
            Err(e) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
            }
        };

    let redirect_url = format!(
        "{}?token={}&state={}&workspaces={}",
        form.redirect_uri,
        url_encode(&raw_token),
        url_encode(&form.state),
        url_encode(&workspace_param),
    );

    Json(ConnectResult { callback_url: redirect_url }).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/tokens — list tokens for current user
// ---------------------------------------------------------------------------

pub async fn list_tokens(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Vec<TokenSummary>>, (StatusCode, String)> {
    // Token management requires a session (not a token itself).
    if !matches!(auth_user.source, AuthSource::Session) {
        return Err((StatusCode::FORBIDDEN, "session required for token management".into()));
    }

    let rows = db::list_api_tokens_for_user(&state.pool, auth_user.user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let summaries = rows
        .into_iter()
        .map(|r| {
            let scopes: Vec<String> = serde_json::from_str(&r.scopes)
                .unwrap_or_else(|_| vec!["workspace/*".to_string()]);
            TokenSummary {
                id: r.id,
                name: r.name,
                scopes,
                created_at: r.created_at,
                last_used_at: r.last_used_at,
            }
        })
        .collect();

    Ok(Json(summaries))
}

// ---------------------------------------------------------------------------
// DELETE /api/tokens/{id} — delete a token
// ---------------------------------------------------------------------------

pub async fn delete_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Token management requires a session.
    if !matches!(auth_user.source, AuthSource::Session) {
        return Err((StatusCode::FORBIDDEN, "session required for token management".into()));
    }

    let deleted = db::delete_api_token(&state.pool, &id, auth_user.user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "token not found".into()))
    }
}

// ---------------------------------------------------------------------------
// URL encoding helper — avoids pulling in a template engine
// ---------------------------------------------------------------------------

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
