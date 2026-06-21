//! Export endpoints — authenticated, workspace-scoped.
//!
//! - `GET /api/workspaces/{id}/export/file/{*path}` — download a single file
//! - `GET /api/workspaces/{id}/export/dir/{*path}`  — download a subtree as zip
//! - `GET /api/workspaces/{id}/export/dir`          — download entire workspace as zip

use async_zip::{Compression, ZipEntryBuilder};
use async_zip::tokio::write::ZipFileWriter;
use axum::{
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::io::AsyncWriteExt;
use axum::http::header;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::auth::AuthUser;
use crate::{db, server_workspace, state::AppState};

// --- Error type ---

pub(crate) enum ApiError {
    Internal(String),
    WorkspaceNotFound,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::WorkspaceNotFound =>
                (StatusCode::NOT_FOUND, "workspace not found").into_response(),
            ApiError::Internal(msg) =>
                (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response(),
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self { Self::Internal(e.to_string()) }
}
impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self { Self::Internal(e.to_string()) }
}
impl From<wrazz_core::BackendError> for ApiError {
    fn from(e: wrazz_core::BackendError) -> Self { Self::Internal(e.to_string()) }
}

// --- Workspace resolution ---

async fn resolve(
    state: &AppState,
    workspace_id: Uuid,
    auth: &AuthUser,
) -> Result<std::sync::Arc<dyn wrazz_core::Workspace>, ApiError> {
    if !auth.workspace_allowed(&workspace_id.to_string()) {
        return Err(ApiError::WorkspaceNotFound);
    }

    let ws_info = db::get_workspace(&state.pool, &workspace_id.to_string(), auth.user.id)
        .await?
        .ok_or(ApiError::WorkspaceNotFound)?;

    server_workspace::get_or_init(
        &state.workspace_registry,
        &state.data_dir,
        workspace_id,
        auth.user.id,
        &ws_info.name,
    )
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))
}

// --- Handlers ---

pub(crate) async fn export_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    let ws = resolve(&state, workspace_id, &auth_user).await?;
    let content = ws.get_file_content(&format!("/{rel}")).await?;
    let filename = rel.split('/').next_back().unwrap_or(&rel).to_string();

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "text/markdown; charset=utf-8")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\""))
        .body(Body::from(content.content.into_bytes()))
        .unwrap())
}

pub(crate) async fn export_dir(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((workspace_id, rel)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    build_zip_response(state, auth_user, workspace_id, &rel).await
}

pub(crate) async fn export_dir_root(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(workspace_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    build_zip_response(state, auth_user, workspace_id, "").await
}

async fn build_zip_response(
    state: AppState,
    auth_user: AuthUser,
    workspace_id: Uuid,
    raw_rel: &str,
) -> Result<Response, ApiError> {
    let rel_path = raw_rel.trim_matches('/');
    let ws = resolve(&state, workspace_id, &auth_user).await?;

    let walk_root = if rel_path.is_empty() { "/".to_string() } else { format!("/{rel_path}") };
    let file_paths = ws.walk_files(&walk_root).await?;

    let strip_prefix = if rel_path.is_empty() {
        String::new()
    } else {
        format!("{}/", rel_path)
    };

    let zip_name = if rel_path.is_empty() {
        "workspace".to_string()
    } else {
        rel_path.split('/').next_back().unwrap_or("export").to_string()
    };

    // Collect file bytes before streaming — avoids holding the workspace Arc
    // across the spawn boundary.
    let mut file_data: Vec<(String, Vec<u8>)> = Vec::with_capacity(file_paths.len());
    for file_path in &file_paths {
        let entry_name = if strip_prefix.is_empty() {
            file_path.clone()
        } else {
            file_path.strip_prefix(&strip_prefix).unwrap_or(file_path).to_string()
        };
        let abs_path = format!("/{file_path}");
        match ws.get_file_content(&abs_path).await {
            Ok(c) => file_data.push((entry_name, c.content.into_bytes())),
            Err(e) => tracing::warn!("skipping {file_path} during export: {e}"),
        }
    }

    let (writer, reader) = tokio::io::duplex(65536);
    let stream = ReaderStream::new(reader);

    tokio::spawn(async move {
        let mut zip = ZipFileWriter::new(writer.compat_write());
        for (entry_name, bytes) in file_data {
            let entry = ZipEntryBuilder::new(entry_name.into(), Compression::Deflate);
            let Ok(mut ew) = zip.write_entry_stream(entry).await else { return };
            if ew.write_all(&bytes).await.is_err() { return; }
            if ew.close().await.is_err() { return; }
        }
        let _ = zip.close().await;
    });

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{zip_name}.zip\""))
        .body(Body::from_stream(stream))
        .unwrap())
}
