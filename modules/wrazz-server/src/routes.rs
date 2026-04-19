/// Assembles the full Axum router: auth routes under `/api/auth/` and
/// user-scoped file CRUD under `/api/files/`. All file handlers require a
/// valid session via the [`AuthUser`] extractor; auth routes are open.
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use tower_http::cors::CorsLayer;
use wrazz_backend::StoreError;
use wrazz_core::FileEntry;

use crate::auth::{self, AuthUser};
use crate::oidc;
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    let auth_routes = Router::new()
        .route("/register", post(auth::register))
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/me", get(auth::me))
        .route("/oidc/redirect", get(oidc::oidc_redirect))
        .route("/oidc/callback", get(oidc::oidc_callback));

    let file_routes = Router::new()
        .route("/files", get(list_files).post(create_file))
        .route("/files/{id}", get(get_file).put(update_file).delete(delete_file));

    let api = Router::new()
        .nest("/auth", auth_routes)
        .merge(file_routes);

    Router::new()
        .nest("/api", api)
        .layer(CorsLayer::permissive())
        .with_state(state)
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
