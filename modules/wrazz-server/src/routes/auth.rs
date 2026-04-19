use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::{Json, extract::{FromRef, State}, http::StatusCode};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use serde::Deserialize;
use uuid::Uuid;
use wrazz_server::User;

use crate::db;
use crate::state::AppState;

/// Name of the session cookie set on login and cleared on logout.
pub const SESSION_COOKIE: &str = "wrazz_session";

/// Axum extractor that authenticates the current request.
///
/// Reads the [`SESSION_COOKIE`] from the request headers, parses it as a
/// UUID, and resolves it against the `sessions` table. If the session exists
/// and hasn't expired, the associated [`User`] is returned.
///
/// Any handler that requires authentication simply declares `auth_user:
/// AuthUser` as a parameter. Unauthenticated or expired requests are rejected
/// with `401 Unauthorized` before the handler body runs.
pub struct AuthUser(pub User);

impl<S> axum::extract::FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = (StatusCode, &'static str);

    fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        // Extract synchronously before entering the async block so we don't
        // hold a reference to `parts` or `state` across the await point.
        let app_state = AppState::from_ref(state);
        let jar = CookieJar::from_headers(&parts.headers);

        async move {
            let session_id = jar
                .get(SESSION_COOKIE)
                .and_then(|c| Uuid::parse_str(c.value()).ok())
                .ok_or((StatusCode::UNAUTHORIZED, "missing or invalid session"))?;

            let user = db::get_session_user(&app_state.pool, session_id)
                .await
                .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
                .ok_or((StatusCode::UNAUTHORIZED, "session expired or not found"))?;

            Ok(AuthUser(user))
        }
    }
}

// --- Request bodies ---

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

// --- Handlers ---

/// `POST /api/auth/login` — verifies credentials and sets a session cookie.
///
/// The same generic `401` is returned for both "user not found" and "wrong
/// password" to avoid leaking whether a username exists.
pub async fn login(
    jar: CookieJar,
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, StatusCode), (StatusCode, &'static str)> {
    let row = db::get_user_by_password_subject(&state.pool, &req.username)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let (user, hash) = row.ok_or((StatusCode::UNAUTHORIZED, "invalid credentials"))?;

    let parsed =
        PasswordHash::new(&hash).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?;

    Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid credentials"))?;

    let session_id = db::create_session(&state.pool, user.id, state.session_duration)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let cookie = Cookie::build((SESSION_COOKIE, session_id.to_string()))
        .http_only(true)
        .path("/")
        .build();

    Ok((jar.add(cookie), StatusCode::OK))
}

/// `POST /api/auth/logout` — deletes the session from the DB and clears the cookie.
///
/// Always succeeds, even if the session cookie is absent or already expired.
pub async fn logout(
    jar: CookieJar,
    State(state): State<AppState>,
) -> (CookieJar, StatusCode) {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        if let Ok(session_id) = Uuid::parse_str(c.value()) {
            let _ = db::delete_session(&state.pool, session_id).await;
        }
    }
    let removal = Cookie::build(SESSION_COOKIE).path("/").build();
    (jar.remove(removal), StatusCode::NO_CONTENT)
}
