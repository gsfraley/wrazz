/// Assembles the full Axum router.
///
/// - `POST /api/auth/login`, `POST /api/auth/logout` — open
/// - `GET /api/auth/oidc/redirect`, `GET /api/auth/oidc/callback` — open
/// - `POST /api/user` — admin only
/// - `GET /api/user/self`, `GET /api/user/id:<uuid>` — authenticated
/// - `GET|POST /api/files`, `GET|PUT|DELETE /api/files/{id}` — authenticated
pub mod auth;
pub mod oidc;
pub mod user;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use tower_http::{cors::CorsLayer, services::{ServeDir, ServeFile}};
use wrazz_backend::StoreError;
use wrazz_core::FileEntry;

use auth::AuthUser;
use crate::state::AppState;

/// `static_dir` is the path to the built frontend assets. When `Some`, all
/// requests that don't match an API route fall through to `ServeDir`, with
/// `index.html` as the fallback so client-side routing works correctly.
pub fn router(state: AppState, static_dir: Option<String>) -> Router {
    let auth_routes = Router::new()
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/oidc/redirect", get(oidc::oidc_redirect))
        .route("/oidc/callback", get(oidc::oidc_callback));

    // Static segment (/self) must be registered before the parameterised one
    // (/{handle}) so axum's router gives it priority.
    let user_routes = Router::new()
        .route("/user", post(user::create_user))
        .route("/user/self", get(user::get_user_self))
        .route("/user/{handle}", get(user::get_user_by_handle));

    let file_routes = Router::new()
        .route("/files", get(list_files).post(create_file))
        .route("/files/{id}", get(get_file).put(update_file).delete(delete_file));

    let api = Router::new()
        .nest("/auth", auth_routes)
        .merge(user_routes)
        .merge(file_routes);

    let base = Router::new()
        .nest("/api", api)
        .layer(CorsLayer::permissive())
        .with_state(state);

    match static_dir {
        Some(dir) => base.fallback_service(
            ServeDir::new(&dir).fallback(ServeFile::new(format!("{dir}/index.html"))),
        ),
        None => base,
    }
}

// --- Error type ---

struct ApiError(StoreError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            StoreError::NotFound { .. } => StatusCode::NOT_FOUND,
            StoreError::Conflict { .. } => StatusCode::CONFLICT,
            StoreError::Io(_) | StoreError::Parse { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.0.to_string()).into_response()
    }
}

impl From<StoreError> for ApiError {
    fn from(e: StoreError) -> Self {
        Self(e)
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        Self(StoreError::Io(e))
    }
}

// --- Request bodies ---

#[derive(Deserialize)]
struct CreateRequest {
    title: String,
    content: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct UpdateRequest {
    title: String,
    content: String,
    #[serde(default)]
    tags: Vec<String>,
}

// --- File handlers (user-scoped) ---

async fn list_files(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.list().await?))
}

async fn get_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<FileEntry>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.load(&id).await?))
}

async fn create_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    let entry = store.create(req.title, req.content, req.tags).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn update_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.save(&id, req.title, req.content, req.tags).await?))
}

async fn delete_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    store.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}
