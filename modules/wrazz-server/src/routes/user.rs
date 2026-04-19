//! User management endpoints.
//!
//! Routes:
//! - `POST /api/user` — create a new password-auth account (admin only)
//! - `GET /api/user/self` — return the calling user's own record
//! - `GET /api/user/id:<uuid>` — look up a user by UUID (self or admin only)

use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{Json, extract::{Path, State}, http::StatusCode};
use serde::Deserialize;
use uuid::Uuid;
use wrazz_server::User;

use super::auth::AuthUser;
use crate::db;
use crate::state::AppState;

// --- Request bodies ---

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub display_name: String,
}

// --- Handlers ---

/// `POST /api/user` — create a new password-auth account.
///
/// Requires the caller to be an admin. Returns `403 Forbidden` otherwise.
/// Returns `409 Conflict` if the username is already taken.
pub async fn create_user(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<User>), (StatusCode, String)> {
    if !auth_user.0.is_admin {
        return Err((StatusCode::FORBIDDEN, "admin required".into()));
    }

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .to_string();

    let user = db::create_user_with_password(
        &state.pool,
        &req.display_name,
        &req.username,
        &hash,
        false,
    )
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref dbe) = e {
            if dbe.is_unique_violation() {
                return (StatusCode::CONFLICT, "username already taken".into());
            }
        }
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    Ok((StatusCode::CREATED, Json(user)))
}

/// `GET /api/user/self` — return the authenticated caller's own user record.
pub async fn get_user_self(auth_user: AuthUser) -> Json<User> {
    Json(auth_user.0)
}

/// `GET /api/user/id:<uuid>` — look up a user by their UUID.
///
/// Only the user themselves or an admin may call this. All other authenticated
/// callers receive `403 Forbidden`. An unknown ID returns `404 Not Found`.
pub async fn get_user_by_handle(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(handle): Path<String>,
) -> Result<Json<User>, (StatusCode, String)> {
    let target_id = parse_handle(&handle)?;

    let is_self = auth_user.0.id == target_id;
    let is_admin = auth_user.0.is_admin;
    if !is_self && !is_admin {
        return Err((StatusCode::FORBIDDEN, "access denied".into()));
    }

    let user = db::get_user_by_id(&state.pool, target_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("no user with {handle}")))?;

    Ok(Json(user))
}

// --- Handle parsing ---

/// Parses a typed user handle in the form `type:value`.
///
/// Currently only `id:<uuid>` is recognised. Returns `400 Bad Request` for
/// unknown handle types or malformed values.
fn parse_handle(handle: &str) -> Result<Uuid, (StatusCode, String)> {
    let (kind, value) = handle
        .split_once(':')
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "handle must be type:value".into()))?;

    match kind {
        "id" => Uuid::parse_str(value)
            .map_err(|_| (StatusCode::BAD_REQUEST, format!("invalid UUID: '{value}'"))),
        other => Err((
            StatusCode::BAD_REQUEST,
            format!("unknown handle type '{other}'"),
        )),
    }
}
