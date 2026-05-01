//! File and directory endpoints (user-scoped, workspace-implicit).
//!
//! Routes (all under `/api/`):
//! - `GET    /entries?path=<path>`  — list direct children of a directory
//! - `DELETE /entries/{*path}`      — delete a file or directory (recursive)
//! - `PATCH  /entries/{*path}`      — move/rename an entry
//! - `GET    /files/{*path}`        — get file metadata (no content)
//! - `GET    /content/{*path}`      — get file content
//! - `POST   /files/{*path}`        — create a file
//! - `PUT    /files/{*path}`        — replace a file's content
//! - `POST   /dirs/{*path}`         — create a directory

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use wrazz_backend::StoreError;
use wrazz_core::{Entry, FileContent, FileEntry};

use super::auth::AuthUser;
use crate::{db, state::AppState};

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
    fn from(e: StoreError) -> Self { Self(e) }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self { Self(StoreError::Io(e)) }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self(StoreError::Io(std::io::Error::other(e)))
    }
}

// --- Request bodies ---

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default = "root_path")]
    pub path: String,
}

fn root_path() -> String { "/".to_string() }

#[derive(Deserialize)]
pub struct CreateFileRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub content: String,
}

#[derive(Deserialize)]
pub struct UpdateFileRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub content: String,
}

#[derive(Deserialize)]
pub struct MoveRequest {
    pub to_path: String,
    /// Destination workspace. Accepted on the wire but ignored until
    /// multi-workspace support is implemented server-side.
    #[allow(dead_code)]
    pub to_workspace: Option<String>,
}

// --- Path helpers ---

/// Strips the leading `/` for Store method calls.
fn to_rel(path: &str) -> &str {
    path.trim_start_matches('/')
}

// --- Handlers ---

pub async fn list_entries(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Entry>>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.list(to_rel(&q.path)).await?))
}

pub async fn get_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
) -> Result<Json<FileEntry>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.load_metadata(&rel).await?))
}

pub async fn get_file_content(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
) -> Result<Json<FileContent>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.load_content(&rel).await?))
}

pub async fn create_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
    Json(req): Json<CreateFileRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    // Ensure the user has a default workspace record.
    let _ = db::get_or_create_default_workspace(&state.pool, auth_user.0.id).await?;
    let entry = store.create(&rel, req.title, req.tags, req.content).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

pub async fn update_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
    Json(req): Json<UpdateFileRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    Ok(Json(store.save(&rel, req.title, req.tags, req.content).await?))
}

pub async fn delete_entry(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
) -> Result<StatusCode, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    store.delete_entry(&rel).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn create_dir(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
) -> Result<StatusCode, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    store.create_dir(&rel).await?;
    Ok(StatusCode::CREATED)
}

pub async fn move_entry(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
    Json(req): Json<MoveRequest>,
) -> Result<StatusCode, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    store.rename_entry(&rel, to_rel(&req.to_path)).await?;
    Ok(StatusCode::NO_CONTENT)
}
