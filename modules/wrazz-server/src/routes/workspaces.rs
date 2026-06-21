//! Workspace CRUD endpoints.
//!
//! Routes (all under `/api/workspaces`):
//! - `GET    /workspaces`        — list the calling user's workspaces
//! - `POST   /workspaces`        — create a new workspace
//! - `GET    /workspaces/{id}`   — get a single workspace
//! - `PATCH  /workspaces/{id}`   — rename a workspace
//! - `DELETE /workspaces/{id}`   — delete a workspace (must be empty)

use axum::{Json, extract::{Path, State}, http::StatusCode};
use serde::Deserialize;
use wrazz_core::WorkspaceSummary;

use super::auth::{AuthSource, AuthUser};
use crate::{db, server_workspace, state::AppState};

// --- Request bodies ---

#[derive(Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct RenameWorkspaceRequest {
    pub name: String,
}

// --- Handlers ---

pub async fn list_workspaces(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Vec<WorkspaceSummary>>, (StatusCode, String)> {
    let mut workspaces = db::list_workspaces(&state.pool, auth_user.user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // When authenticated via a token, filter to only workspaces in scope.
    if let AuthSource::Token { scopes } = &auth_user.source {
        workspaces.retain(|ws| {
            let target = format!("workspace/{}", ws.id);
            scopes.iter().any(|s| s == "workspace/*" || s == &target)
        });
    }

    Ok(Json(workspaces))
}

pub async fn create_workspace(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateWorkspaceRequest>,
) -> Result<(StatusCode, Json<WorkspaceSummary>), (StatusCode, String)> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err((StatusCode::UNPROCESSABLE_ENTITY, "name must not be blank".into()));
    }

    let summary = db::create_workspace(&state.pool, auth_user.user.id, &name)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Pre-create the directory so it's ready immediately.
    let ws_id = uuid::Uuid::parse_str(&summary.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    server_workspace::get_or_init(
        &state.workspace_registry,
        &state.data_dir,
        ws_id,
        auth_user.user.id,
        &summary.name,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(summary)))
}

pub async fn get_workspace(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceSummary>, (StatusCode, String)> {
    db::get_workspace(&state.pool, &workspace_id, auth_user.user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "workspace not found".into()))
}

pub async fn rename_workspace(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(workspace_id): Path<String>,
    Json(req): Json<RenameWorkspaceRequest>,
) -> Result<Json<WorkspaceSummary>, (StatusCode, String)> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err((StatusCode::UNPROCESSABLE_ENTITY, "name must not be blank".into()));
    }

    let updated = db::rename_workspace(&state.pool, &workspace_id, auth_user.user.id, &name)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !updated {
        return Err((StatusCode::NOT_FOUND, "workspace not found".into()));
    }

    // Evict from registry so the next access picks up the new name.
    state.workspace_registry.remove(&workspace_id).await;

    let summary = db::get_workspace(&state.pool, &workspace_id, auth_user.user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "workspace not found".into()))?;

    Ok(Json(summary))
}

pub async fn delete_workspace(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(workspace_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let summary = db::get_workspace(&state.pool, &workspace_id, auth_user.user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "workspace not found".into()))?;

    // Refuse to delete a workspace that still contains files.
    let ws_id = uuid::Uuid::parse_str(&workspace_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let ws = server_workspace::get_or_init(
        &state.workspace_registry,
        &state.data_dir,
        ws_id,
        auth_user.user.id,
        &summary.name,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let files = ws.walk_files("/").await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !files.is_empty() {
        return Err((
            StatusCode::CONFLICT,
            format!("workspace is not empty ({} file(s)); delete all files first", files.len()),
        ));
    }

    db::delete_workspace(&state.pool, &workspace_id, auth_user.user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    state.workspace_registry.remove(&workspace_id).await;

    Ok(StatusCode::NO_CONTENT)
}
