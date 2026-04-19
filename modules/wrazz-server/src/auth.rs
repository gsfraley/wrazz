use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{Json, extract::{FromRef, State}, http::StatusCode};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use serde::Deserialize;
use uuid::Uuid;
use wrazz_server::User;

use crate::db;
use crate::state::AppState;

pub const SESSION_COOKIE: &str = "wrazz_session";

// --- AuthUser extractor ---
//
// Pulls the session cookie from the request, validates it against the DB,
// and produces the authenticated User. Any route that requires login takes
// this as a parameter; unauthenticated requests are rejected at extraction time.

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
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

// --- Handlers ---

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<User>), (StatusCode, String)> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .to_string();

    let user =
        db::create_user_with_password(&state.pool, &req.display_name, &req.username, &hash)
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

pub async fn me(auth_user: AuthUser) -> Json<User> {
    Json(auth_user.0)
}
