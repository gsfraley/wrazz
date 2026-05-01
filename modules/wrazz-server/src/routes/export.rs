//! Export endpoints — authenticated, scoped to the requesting user's workspace.
//!
//! - `GET /api/export/file/{*path}` — download a single file as `text/markdown`
//! - `GET /api/export/dir/{*path}`  — download a directory subtree as a zip
//! - `GET /api/export/dir`          — download the entire workspace as a zip

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
use wrazz_backend::StoreError;

use super::auth::AuthUser;
use crate::state::AppState;

// --- Error type ---

pub(crate) struct ApiError(StoreError);

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

// --- Handlers ---

pub async fn export_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
) -> Result<Response, ApiError> {
    let store = state.store_cache.get_or_create(auth_user.0.id).await?;
    let bytes = store.read_raw(&rel).await?;
    let filename = rel.split('/').next_back().unwrap_or(&rel).to_string();

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "text/markdown; charset=utf-8")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\""))
        .body(Body::from(bytes))
        .unwrap())
}

pub async fn export_dir(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(rel): Path<String>,
) -> Result<Response, ApiError> {
    build_zip_response(state, auth_user.0.id, &rel).await
}

pub async fn export_dir_root(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Response, ApiError> {
    build_zip_response(state, auth_user.0.id, "").await
}

async fn build_zip_response(
    state: AppState,
    user_id: Uuid,
    raw_rel: &str,
) -> Result<Response, ApiError> {
    let rel_path = raw_rel.trim_matches('/');
    let store = state.store_cache.get_or_create(user_id).await?;

    let file_paths = store.walk_files(rel_path).await?;

    // Prefix to strip so zip entries are relative to the exported root.
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

    // Collect raw bytes up front so the Arc<Store> doesn't need to cross the spawn boundary.
    let mut file_data: Vec<(String, Vec<u8>)> = Vec::with_capacity(file_paths.len());
    for file_path in &file_paths {
        let entry_name = if strip_prefix.is_empty() {
            file_path.clone()
        } else {
            file_path.strip_prefix(&strip_prefix).unwrap_or(file_path).to_string()
        };
        match store.read_raw(file_path).await {
            Ok(bytes) => file_data.push((entry_name, bytes)),
            Err(e) => tracing::warn!("skipping {file_path} during export: {e}"),
        }
    }

    // Stream the zip through a tokio duplex channel.
    // async_zip's tokio module uses futures-style AsyncWrite internally, so the
    // writer side needs to be compat-wrapped via TokioAsyncWriteCompatExt.
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
