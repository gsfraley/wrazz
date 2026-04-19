//! File CRUD endpoints (user-scoped).
//!
//! Routes:
//! - `GET    /api/files`       — list all files for the authenticated user
//! - `POST   /api/files`       — create a new file
//! - `GET    /api/files/{id}`  — fetch a single file
//! - `PUT    /api/files/{id}`  — replace a file's content
//! - `DELETE /api/files/{id}`  — delete a file

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use wrazz_backend::StoreError;
use wrazz_core::FileEntry;

use super::auth::AuthUser;
use crate::state::AppState;

// --- Error type ---

pub struct ApiError(StoreError);

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
pub struct CreateRequest {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
pub struct UpdateRequest {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

// --- Handlers ---

pub async fn list_files(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.list().await?))
}

pub async fn get_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<FileEntry>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.load(&id).await?))
}

pub async fn create_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    let entry = store.create(req.title, req.content, req.tags).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

pub async fn update_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.save(&id, req.title, req.content, req.tags).await?))
}

pub async fn delete_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    store.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}
