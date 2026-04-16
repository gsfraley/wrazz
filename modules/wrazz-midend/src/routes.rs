use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use tower_http::cors::CorsLayer;
use wrazz_core::{Backend, BackendError, FileEntry};

pub fn router(backend: Arc<dyn Backend>) -> Router {
    Router::new()
        .route("/api/files", get(list_files).post(create_file))
        .route(
            "/api/files/{id}",
            get(get_file).put(update_file).delete(delete_file),
        )
        .with_state(backend)
        // Permissive CORS for local development (Vite runs on a different port).
        // Tighten this before any public-facing deployment.
        .layer(CorsLayer::permissive())
}

// --- Error mapping ---

struct ApiError(BackendError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            BackendError::NotFound(_) => StatusCode::NOT_FOUND,
            BackendError::Conflict(_) => StatusCode::CONFLICT,
            BackendError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.0.to_string()).into_response()
    }
}

impl From<BackendError> for ApiError {
    fn from(e: BackendError) -> Self {
        Self(e)
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

// --- Handlers ---

async fn list_files(
    State(backend): State<Arc<dyn Backend>>,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    Ok(Json(backend.list_files().await?))
}

async fn get_file(
    State(backend): State<Arc<dyn Backend>>,
    Path(id): Path<String>,
) -> Result<Json<FileEntry>, ApiError> {
    Ok(Json(backend.get_file(&id).await?))
}

async fn create_file(
    State(backend): State<Arc<dyn Backend>>,
    Json(req): Json<CreateRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let entry = backend
        .create_file(req.title, req.content, req.tags)
        .await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn update_file(
    State(backend): State<Arc<dyn Backend>>,
    Path(id): Path<String>,
    Json(req): Json<UpdateRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    Ok(Json(
        backend
            .update_file(&id, req.title, req.content, req.tags)
            .await?,
    ))
}

async fn delete_file(
    State(backend): State<Arc<dyn Backend>>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    backend.delete_file(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}
