use std::{path::PathBuf, sync::Arc};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::RwLock;
use tower_http::cors::{AllowOrigin, CorsLayer};
use uuid::Uuid;
use wrazz_backend::WorkspaceRegistry;
use wrazz_core::{BackendError, Entry, FileContent, FileEntry, Workspace};

use crate::{
    connect::ConnectState,
    workspace_config::{WorkspaceConfig, WorkspaceEntry},
};

// --- Shared server state ---

#[derive(Clone)]
pub struct ServerState {
    pub registry: Arc<WorkspaceRegistry>,
    pub shared_config: Arc<RwLock<WorkspaceConfig>>,
    pub config_path: Arc<PathBuf>,
    pub connect_state: Arc<ConnectState>,
    pub api_port: u16,
    pub app_handle: AppHandle,
}

// --- Error type ---

pub enum ApiError {
    WorkspaceNotFound,
    Backend(BackendError),
    Other(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::WorkspaceNotFound => {
                (StatusCode::NOT_FOUND, "workspace not found").into_response()
            }
            ApiError::Backend(e) => {
                let status = match &e {
                    BackendError::NotFound(_) => StatusCode::NOT_FOUND,
                    BackendError::Conflict(_) => StatusCode::CONFLICT,
                    BackendError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
                };
                (status, e.to_string()).into_response()
            }
            ApiError::Other(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response(),
        }
    }
}

impl From<BackendError> for ApiError {
    fn from(e: BackendError) -> Self {
        Self::Backend(e)
    }
}

// --- Response types ---

#[derive(Serialize)]
struct WorkspaceSummary {
    id: String,
    name: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server_url: Option<String>,
}

fn entry_to_summary(entry: &WorkspaceEntry) -> WorkspaceSummary {
    match entry {
        WorkspaceEntry::Local { id, name, path } => WorkspaceSummary {
            id: id.clone(),
            name: name.clone(),
            kind: "local",
            path: Some(path.to_string_lossy().into_owned()),
            server_url: None,
        },
        WorkspaceEntry::Remote(cfg) => WorkspaceSummary {
            id: cfg.id.clone(),
            name: cfg.name.clone(),
            kind: "remote",
            path: None,
            server_url: Some(cfg.server_url.clone()),
        },
    }
}

// --- Request types ---

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AddWorkspaceRequest {
    Local { name: String, path: PathBuf },
    Remote { server_url: String, token: String, workspace_id: String, name: String },
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "root_path")]
    path: String,
}

fn root_path() -> String {
    "/".to_string()
}

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
}

// --- Router construction ---

pub fn build_router(
    registry: Arc<WorkspaceRegistry>,
    shared_config: Arc<RwLock<WorkspaceConfig>>,
    config_path: Arc<PathBuf>,
    connect_state: Arc<ConnectState>,
    api_port: u16,
    app_handle: AppHandle,
) -> Router {
    let state = ServerState {
        registry,
        shared_config,
        config_path,
        connect_state,
        api_port,
        app_handle,
    };

    let workspace_ops = Router::new()
        .route("/entries", get(list_entries))
        .route("/entries/{*path}", delete(delete_entry).patch(move_entry))
        .route("/files/{*path}", post(create_file).get(get_file).put(update_file))
        .route("/content/{*path}", get(get_file_content))
        .route("/dirs/{*path}", post(create_dir));

    let api = Router::new()
        .route("/version", get(get_version))
        .route("/workspaces", get(list_workspaces).post(add_workspace))
        .route("/workspaces/{workspace_id}", delete(remove_workspace))
        .nest("/workspaces/{workspace_id}", workspace_ops);

    let cors = build_cors();

    Router::new()
        .nest("/api/v1", api)
        .route("/connect/callback", get(crate::connect::connect_callback))
        .layer(cors)
        .with_state(state)
}

fn build_cors() -> CorsLayer {
    #[cfg(debug_assertions)]
    {
        CorsLayer::new()
            .allow_origin(AllowOrigin::predicate(|origin, _| {
                let b = origin.as_bytes();
                b.starts_with(b"http://localhost:") || b.starts_with(b"http://127.0.0.1:")
            }))
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any)
    }
    #[cfg(not(debug_assertions))]
    {
        CorsLayer::permissive()
    }
}

// --- Workspace resolution helper ---

async fn resolve(
    state: &ServerState,
    workspace_id: &str,
) -> Result<Arc<dyn Workspace>, ApiError> {
    state
        .registry
        .get(workspace_id)
        .await
        .ok_or(ApiError::WorkspaceNotFound)
}

// --- Workspace management handlers ---

async fn get_version() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "version": env!("CARGO_PKG_VERSION") }))
}

async fn list_workspaces(
    State(state): State<ServerState>,
) -> Json<Vec<WorkspaceSummary>> {
    let config = state.shared_config.read().await;
    let summaries = config.workspaces.iter().map(entry_to_summary).collect();
    Json(summaries)
}

async fn add_workspace(
    State(state): State<ServerState>,
    Json(req): Json<AddWorkspaceRequest>,
) -> Result<(StatusCode, Json<WorkspaceSummary>), ApiError> {
    match req {
        AddWorkspaceRequest::Local { name, path } => {
            let id = Uuid::new_v4().to_string();
            let store = wrazz_backend::Store::new(path.clone());
            let ws = Arc::new(wrazz_backend::LocalWorkspace::new(id.clone(), name.clone(), store));
            state.registry.add(ws).await;

            let entry = WorkspaceEntry::Local { id, name, path };
            let summary = entry_to_summary(&entry);

            let mut config = state.shared_config.write().await;
            config.add(entry);
            config
                .save(&state.config_path)
                .map_err(|e| ApiError::Other(e.to_string()))?;

            Ok((StatusCode::CREATED, Json(summary)))
        }
        AddWorkspaceRequest::Remote { server_url, token, workspace_id, name } => {
            let cfg = wrazz_backend::RemoteWorkspaceConfig {
                id: workspace_id,
                name,
                server_url,
                token,
            };
            let ws = Arc::new(wrazz_backend::RemoteWorkspace::new(cfg.clone()));
            state.registry.add(ws).await;

            let entry = WorkspaceEntry::Remote(cfg);
            let summary = entry_to_summary(&entry);

            let mut config = state.shared_config.write().await;
            config.add(entry);
            config
                .save(&state.config_path)
                .map_err(|e| ApiError::Other(e.to_string()))?;

            Ok((StatusCode::CREATED, Json(summary)))
        }
    }
}

async fn remove_workspace(
    State(state): State<ServerState>,
    Path(workspace_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.registry.remove(&workspace_id).await;

    let mut config = state.shared_config.write().await;
    config.remove(&workspace_id);
    config
        .save(&state.config_path)
        .map_err(|e| ApiError::Other(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// --- File operation handlers ---

async fn list_entries(
    State(state): State<ServerState>,
    Path(workspace_id): Path<String>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Entry>>, ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    Ok(Json(ws.list_entries(&q.path).await?))
}

async fn get_file(
    State(state): State<ServerState>,
    Path((workspace_id, rel)): Path<(String, String)>,
) -> Result<Json<FileEntry>, ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    Ok(Json(ws.get_file(&format!("/{rel}")).await?))
}

async fn get_file_content(
    State(state): State<ServerState>,
    Path((workspace_id, rel)): Path<(String, String)>,
) -> Result<Json<FileContent>, ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    Ok(Json(ws.get_file_content(&format!("/{rel}")).await?))
}

async fn create_file(
    State(state): State<ServerState>,
    Path((workspace_id, rel)): Path<(String, String)>,
    Json(req): Json<CreateFileRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    let entry = ws.create_file(&format!("/{rel}"), req.title, req.tags, req.content).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn update_file(
    State(state): State<ServerState>,
    Path((workspace_id, rel)): Path<(String, String)>,
    Json(req): Json<UpdateFileRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    Ok(Json(ws.update_file(&format!("/{rel}"), req.title, req.tags, req.content).await?))
}

async fn delete_entry(
    State(state): State<ServerState>,
    Path((workspace_id, rel)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    ws.delete_entry(&format!("/{rel}")).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn create_dir(
    State(state): State<ServerState>,
    Path((workspace_id, rel)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    ws.create_dir(&format!("/{rel}/")).await?;
    Ok(StatusCode::CREATED)
}

async fn move_entry(
    State(state): State<ServerState>,
    Path((workspace_id, rel)): Path<(String, String)>,
    Json(req): Json<MoveRequest>,
) -> Result<StatusCode, ApiError> {
    let ws = resolve(&state, &workspace_id).await?;
    ws.move_entry(&format!("/{rel}"), &req.to_path).await?;
    Ok(StatusCode::NO_CONTENT)
}
