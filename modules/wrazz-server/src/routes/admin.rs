use std::sync::Arc;

use axum::{Json, extract::{Path, State}, http::StatusCode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use wrazz_server::User;

use crate::db::{self, OidcConfig};
use crate::routes::auth::AuthUser;
use crate::routes::oidc::OidcProvider;
use crate::state::AppState;

/// Sent back for the redacted client_secret field when a config already exists.
const SECRET_REDACT: &str = "••••";

#[derive(Serialize)]
pub struct OidcConfigResponse {
    /// Whether the OIDC provider is currently active in memory.
    pub active: bool,
    /// True when all four `WRAZZ_OIDC_*` env vars are set. The config fields
    /// reflect the env var values and the form is read-only; PUT and DELETE
    /// return 409 while this is true.
    pub env_configured: bool,
    pub issuer_url: String,
    pub client_id: String,
    /// `"••••"` when a secret is stored; empty string when unconfigured.
    pub client_secret: String,
    pub redirect_uri: String,
    pub enabled: bool,
    /// Pre-computed redirect URI derived from `WRAZZ_PUBLIC_URL`, if set.
    pub suggested_redirect_uri: Option<String>,
}

#[derive(Deserialize)]
pub struct OidcConfigRequest {
    pub issuer_url: String,
    pub client_id: String,
    /// If this equals `"••••"`, the server keeps the existing stored secret.
    pub client_secret: String,
    pub redirect_uri: String,
    pub enabled: bool,
}

/// `GET /api/admin/oidc` — return current OIDC config (secret redacted).
///
/// When env vars are driving the config, returns their values with
/// `env_configured: true` so the UI can display them read-only.
pub async fn get_oidc(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<OidcConfigResponse>, (StatusCode, String)> {
    require_admin(&auth_user)?;

    let active = state.oidc_provider.read().await.is_some();
    let suggested = suggested_redirect_uri(&state);

    if env_oidc_configured() {
        return Ok(Json(OidcConfigResponse {
            active,
            env_configured: true,
            issuer_url: std::env::var("WRAZZ_OIDC_ISSUER_URL").unwrap_or_default(),
            client_id: std::env::var("WRAZZ_OIDC_CLIENT_ID").unwrap_or_default(),
            client_secret: SECRET_REDACT.to_string(),
            redirect_uri: std::env::var("WRAZZ_OIDC_REDIRECT_URI").unwrap_or_default(),
            enabled: true,
            suggested_redirect_uri: suggested,
        }));
    }

    let config = db::get_oidc_config(&state.pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(match config {
        Some(c) => OidcConfigResponse {
            active,
            env_configured: false,
            issuer_url: c.issuer_url,
            client_id: c.client_id,
            client_secret: SECRET_REDACT.to_string(),
            redirect_uri: c.redirect_uri,
            enabled: c.enabled,
            suggested_redirect_uri: suggested,
        },
        None => OidcConfigResponse {
            active,
            env_configured: false,
            issuer_url: String::new(),
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: String::new(),
            enabled: false,
            suggested_redirect_uri: suggested,
        },
    }))
}

/// `PUT /api/admin/oidc` — save config and hot-swap the in-memory provider.
///
/// Returns 409 if the `WRAZZ_OIDC_*` env vars are set; unset them to manage
/// OIDC here. Discovery is attempted before writing to the DB so bad config
/// fails fast with 502 and the existing config is untouched.
pub async fn put_oidc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<OidcConfigRequest>,
) -> Result<Json<OidcConfigResponse>, (StatusCode, String)> {
    require_admin(&auth_user)?;
    if env_oidc_configured() {
        return Err((StatusCode::CONFLICT,
            "OIDC is configured via environment variables; unset WRAZZ_OIDC_* to manage it here".into()));
    }

    // Resolve the secret — sentinel means "keep what's stored".
    let actual_secret = if req.client_secret == SECRET_REDACT {
        db::get_oidc_config(&state.pool).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .map(|c| c.client_secret)
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "no existing secret to preserve".to_string()))?
    } else {
        req.client_secret.clone()
    };

    // Run discovery before touching the DB so we fail fast on bad config.
    let new_provider: Option<Arc<OidcProvider>> = if req.enabled {
        match OidcProvider::discover(
            req.issuer_url.clone(),
            req.client_id.clone(),
            actual_secret.clone(),
            req.redirect_uri.clone(),
        ).await {
            Ok(p) => Some(Arc::new(p)),
            Err(e) => return Err((StatusCode::BAD_GATEWAY, format!("OIDC discovery failed: {e}"))),
        }
    } else {
        None
    };

    // Persist.
    db::upsert_oidc_config(&state.pool, &OidcConfig {
        issuer_url: req.issuer_url.clone(),
        client_id: req.client_id.clone(),
        client_secret: actual_secret,
        redirect_uri: req.redirect_uri.clone(),
        enabled: req.enabled,
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Swap in-memory provider only when env vars aren't overriding it.
    if !env_oidc_configured() {
        *state.oidc_provider.write().await = new_provider;
    }

    let active = state.oidc_provider.read().await.is_some();

    Ok(Json(OidcConfigResponse {
        active,
        env_configured: false,
        issuer_url: req.issuer_url,
        client_id: req.client_id,
        client_secret: SECRET_REDACT.to_string(),
        redirect_uri: req.redirect_uri,
        enabled: req.enabled,
        suggested_redirect_uri: suggested_redirect_uri(&state),
    }))
}

/// `DELETE /api/admin/oidc` — remove DB config and disable the provider.
///
/// Returns 409 if the `WRAZZ_OIDC_*` env vars are set; unset them to manage
/// OIDC here.
pub async fn delete_oidc(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&auth_user)?;
    if env_oidc_configured() {
        return Err((StatusCode::CONFLICT,
            "OIDC is configured via environment variables; unset WRAZZ_OIDC_* to manage it here".into()));
    }

    db::delete_oidc_config(&state.pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    *state.oidc_provider.write().await = None;

    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/admin/users` — list all user accounts.
pub async fn list_users(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Vec<User>>, (StatusCode, String)> {
    require_admin(&auth_user)?;
    let users = db::list_users(&state.pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(users))
}

/// `DELETE /api/admin/users/{id}` — delete a user account.
///
/// Returns 400 if the caller tries to delete their own account.
pub async fn delete_user(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&auth_user)?;
    if auth_user.0.id == id {
        return Err((StatusCode::BAD_REQUEST, "cannot delete your own account".into()));
    }
    db::delete_user(&state.pool, id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

// --- Helpers ---

fn require_admin(auth_user: &AuthUser) -> Result<(), (StatusCode, String)> {
    if auth_user.0.is_admin {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, "admin required".into()))
    }
}

fn suggested_redirect_uri(state: &AppState) -> Option<String> {
    state.public_url.as_deref()
        .map(|u| format!("{}/api/auth/oidc/callback", u.trim_end_matches('/')))
}

/// Returns true if all four `WRAZZ_OIDC_*` env vars are set, meaning the
/// in-memory provider is driven by the environment rather than the DB.
fn env_oidc_configured() -> bool {
    ["WRAZZ_OIDC_ISSUER_URL", "WRAZZ_OIDC_CLIENT_ID", "WRAZZ_OIDC_CLIENT_SECRET", "WRAZZ_OIDC_REDIRECT_URI"]
        .iter()
        .all(|k| std::env::var(k).is_ok())
}
