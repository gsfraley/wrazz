use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde::Deserialize;
use tower_http::cors::CorsLayer;
use wrazz_core::{Backend, BackendError, Entry, FileContent, FileEntry};

#[derive(Clone)]
pub struct AppState {
    pub backend: Arc<dyn Backend>,
    pub workspace_id: String,
}

pub fn router(backend: Arc<dyn Backend>, workspace_id: String) -> Router {
    let state = AppState { backend, workspace_id };

    let entry_routes = Router::new()
        .route("/entries", get(list_entries))
        .route("/entries/{*path}", delete(delete_entry).patch(move_entry));

    let file_routes = Router::new()
        .route("/files/{*path}", post(create_file).get(get_file).put(update_file));

    let content_routes = Router::new()
        .route("/content/{*path}", get(get_file_content));

    let dir_routes = Router::new()
        .route("/dirs/{*path}", post(create_dir));

    let api = Router::new()
        .merge(entry_routes)
        .merge(file_routes)
        .merge(content_routes)
        .merge(dir_routes);

    Router::new()
        .nest("/api", api)
        .layer(CorsLayer::permissive())
        .with_state(state)
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
    fn from(e: BackendError) -> Self { Self(e) }
}

// --- Request bodies ---

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "root_path")]
    path: String,
}

fn root_path() -> String { "/".to_string() }

#[derive(Deserialize)]
struct CreateFileRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    content: String,
}

#[derive(Deserialize)]
struct UpdateFileRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    content: String,
}

#[derive(Deserialize)]
struct MoveRequest {
    to_path: String,
    /// Accepted on the wire but ignored until cross-workspace moves are supported.
    #[allow(dead_code)]
    to_workspace: Option<String>,
}

// --- Handlers ---

async fn list_entries(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Entry>>, ApiError> {
    Ok(Json(state.backend.list_entries(&state.workspace_id, &q.path).await?))
}

async fn get_file(
    State(state): State<AppState>,
    Path(rel): Path<String>,
) -> Result<Json<FileEntry>, ApiError> {
    Ok(Json(state.backend.get_file(&state.workspace_id, &format!("/{rel}")).await?))
}

async fn get_file_content(
    State(state): State<AppState>,
    Path(rel): Path<String>,
) -> Result<Json<FileContent>, ApiError> {
    Ok(Json(state.backend.get_file_content(&state.workspace_id, &format!("/{rel}")).await?))
}

async fn create_file(
    State(state): State<AppState>,
    Path(rel): Path<String>,
    Json(req): Json<CreateFileRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let entry = state.backend
        .create_file(&state.workspace_id, &format!("/{rel}"), req.title, req.tags, req.content)
        .await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn update_file(
    State(state): State<AppState>,
    Path(rel): Path<String>,
    Json(req): Json<UpdateFileRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    Ok(Json(
        state.backend
            .update_file(&state.workspace_id, &format!("/{rel}"), req.title, req.tags, req.content)
            .await?,
    ))
}

async fn delete_entry(
    State(state): State<AppState>,
    Path(rel): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.backend.delete_entry(&state.workspace_id, &format!("/{rel}")).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn create_dir(
    State(state): State<AppState>,
    Path(rel): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.backend.create_dir(&state.workspace_id, &format!("/{rel}/")).await?;
    Ok(StatusCode::CREATED)
}

async fn move_entry(
    State(state): State<AppState>,
    Path(rel): Path<String>,
    Json(req): Json<MoveRequest>,
) -> Result<StatusCode, ApiError> {
    state.backend
        .move_entry(&state.workspace_id, &format!("/{rel}"), &state.workspace_id, &req.to_path)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
