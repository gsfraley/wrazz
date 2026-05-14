//! File and directory endpoints (authenticated, workspace-scoped).
//!
//! All routes live under `/api/workspaces/{workspace_id}/` and are registered
//! via the nested router in `routes/mod.rs`.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use uuid::Uuid;
use wrazz_backend::StoreError;
use wrazz_core::{Entry, FileContent, FileEntry};

use super::auth::AuthUser;
use crate::{db, server_workspace, state::AppState};

// --- Error type ---

pub(crate) enum ApiError {
    Store(StoreError),
    WorkspaceNotFound,
    Io(std::io::Error),
    Db(sqlx::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::WorkspaceNotFound =>
                (StatusCode::NOT_FOUND, "workspace not found").into_response(),
            ApiError::Store(e) => {
                let status = match &e {
                    StoreError::NotFound { .. } => StatusCode::NOT_FOUND,
                    StoreError::Conflict { .. } => StatusCode::CONFLICT,
                    StoreError::Io(_) | StoreError::Parse { .. } => StatusCode::INTERNAL_SERVER_ERROR,
                };
                (status, e.to_string()).into_response()
            }
            ApiError::Io(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            ApiError::Db(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        }
    }
}

impl From<StoreError> for ApiError {
    fn from(e: StoreError) -> Self { Self::Store(e) }
}
impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self { Self::Io(e) }
}
impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self { Self::Db(e) }
}
impl From<wrazz_core::BackendError> for ApiError {
    fn from(e: wrazz_core::BackendError) -> Self {
        Self::Store(StoreError::Io(std::io::Error::other(e.to_string())))
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
    /// Cross-workspace moves are not yet implemented; accepted but unused.
    #[allow(dead_code)]
    pub to_workspace: Option<String>,
}

// --- Workspace resolution ---

async fn resolve(
    state: &AppState,
    workspace_id: Uuid,
    user_id: Uuid,
) -> Result<std::sync::Arc<dyn wrazz_core::Workspace>, ApiError> {
    let ws_info = db::get_workspace(&state.pool, &workspace_id.to_string(), user_id)
        .await?
        .ok_or(ApiError::WorkspaceNotFound)?;

    server_workspace::get_or_init(
        &state.workspace_registry,
        &state.data_dir,
        workspace_id,
        user_id,
        &ws_info.name,
    )
    .await
    .map_err(ApiError::Io)
}

// --- Handlers ---

pub(crate) async fn list_entries(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(workspace_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Entry>>, ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    Ok(Json(ws.list_entries(&q.path).await?))
}

pub(crate) async fn get_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
) -> Result<Json<FileEntry>, ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    Ok(Json(ws.get_file(&format!("/{rel}")).await?))
}

pub(crate) async fn get_file_content(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
) -> Result<Json<FileContent>, ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    Ok(Json(ws.get_file_content(&format!("/{rel}")).await?))
}

pub(crate) async fn create_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
    Json(req): Json<CreateFileRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    let entry = ws.create_file(&format!("/{rel}"), req.title, req.tags, req.content).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

pub(crate) async fn update_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
    Json(req): Json<UpdateFileRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    Ok(Json(ws.update_file(&format!("/{rel}"), req.title, req.tags, req.content).await?))
}

pub(crate) async fn delete_entry(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    ws.delete_entry(&format!("/{rel}")).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn create_dir(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    ws.create_dir(&format!("/{rel}/")).await?;
    Ok(StatusCode::CREATED)
}

pub(crate) async fn move_entry(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
    Json(req): Json<MoveRequest>,
) -> Result<StatusCode, ApiError> {
    let ws = resolve(&state, workspace_id, auth_user.0.id).await?;
    ws.move_entry(&format!("/{rel}"), &req.to_path).await?;
    Ok(StatusCode::NO_CONTENT)
}
