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
use wrazz_core::FileEntry;

use crate::store::{Store, StoreError};

pub fn router(store: Arc<Store>) -> Router {
    Router::new()
        .route("/api/files", get(list_files).post(create_file))
        .route(
            "/api/files/{id}",
            get(get_file).put(update_file).delete(delete_file),
        )
        .with_state(store)
        // Permissive CORS for local development (Vite runs on a different port).
        // Tighten this before any public-facing deployment.
        .layer(CorsLayer::permissive())
}

// --- Error mapping ---

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

async fn list_files(State(store): State<Arc<Store>>) -> Result<Json<Vec<FileEntry>>, ApiError> {
    Ok(Json(store.list().await?))
}

async fn get_file(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
) -> Result<Json<FileEntry>, ApiError> {
    Ok(Json(store.load(&id).await?))
}

async fn create_file(
    State(store): State<Arc<Store>>,
    Json(req): Json<CreateRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let entry = store.create(req.title, req.content, req.tags).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn update_file(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    Json(req): Json<UpdateRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    Ok(Json(
        store.save(&id, req.title, req.content, req.tags).await?,
    ))
}

async fn delete_file(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    store.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}
