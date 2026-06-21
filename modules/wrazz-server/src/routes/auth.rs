use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::{Json, extract::{FromRef, State}, http::StatusCode};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use serde::Deserialize;
use uuid::Uuid;
use crate::User;

use crate::db;
use crate::state::AppState;

/// Name of the session cookie set on login and cleared on logout.
pub const SESSION_COOKIE: &str = "wrazz_session";

/// Source of authentication for a request.
pub enum AuthSource {
    /// Session cookie — full access to all of the user's resources.
    Session,
    /// API token — access restricted to the listed workspace scopes.
    Token { scopes: Vec<String> },
}

/// Axum extractor that authenticates the current request.
///
/// Tries session cookie first; falls back to `Authorization: Bearer <token>`.
/// Any handler that requires authentication simply declares `auth_user:
/// AuthUser` as a parameter. Unauthenticated or expired requests are rejected
/// with `401 Unauthorized` before the handler body runs.
pub struct AuthUser {
    pub user: User,
    pub source: AuthSource,
}

impl AuthUser {
    /// Returns `true` if the given workspace ID is within this request's scope.
    pub fn workspace_allowed(&self, workspace_id: &str) -> bool {
        match &self.source {
            AuthSource::Session => true,
            AuthSource::Token { scopes } => {
                let target = format!("workspace/{workspace_id}");
                scopes.iter().any(|s| s == "workspace/*" || s == &target)
            }
        }
    }
}

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
        let bearer = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.to_string());

        async move {
            // 1. Try session cookie.
            if let Some(session_id) = jar
                .get(SESSION_COOKIE)
                .and_then(|c| Uuid::parse_str(c.value()).ok())
            {
                if let Ok(Some(user)) =
                    db::get_session_user(&app_state.pool, session_id).await
                {
                    return Ok(AuthUser { user, source: AuthSource::Session });
                }
            }

            // 2. Try Bearer token.
            if let Some(raw) = bearer {
                let result = db::find_api_token_by_raw(&app_state.pool, &raw)
                    .await
                    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;
                if let Some((token_row, user)) = result {
                    let scopes: Vec<String> = serde_json::from_str(&token_row.scopes)
                        .unwrap_or_else(|_| vec!["workspace/*".to_string()]);
                    return Ok(AuthUser {
                        user,
                        source: AuthSource::Token { scopes },
                    });
                }
            }

            Err((StatusCode::UNAUTHORIZED, "authentication required"))
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
