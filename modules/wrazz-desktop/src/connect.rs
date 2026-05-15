use std::{collections::HashMap, sync::Arc, time::Instant};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tauri::{Emitter, Manager};
use tokio::sync::RwLock;
use wrazz_backend::RemoteWorkspaceConfig;

use crate::{
    server::ServerState,
    workspace_config::WorkspaceEntry,
};

pub struct PendingConnect {
    pub server_url: String,
    pub token_name: String,
    pub created_at: Instant,
}

pub struct ConnectState {
    pub pending: RwLock<HashMap<String, PendingConnect>>,
}

impl ConnectState {
    pub fn new() -> Self {
        Self { pending: RwLock::new(HashMap::new()) }
    }
}

#[derive(Deserialize)]
pub struct CallbackParams {
    pub token: String,
    pub state: String,
    pub workspaces: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceSummaryFromServer {
    id: String,
    name: String,
}

pub async fn connect_callback(
    State(state): State<ServerState>,
    Query(params): Query<CallbackParams>,
) -> Response {
    // Look up and consume the pending nonce (one-time use).
    let pending = {
        let mut guard = state.connect_state.pending.write().await;
        match guard.remove(&params.state) {
            Some(p) => p,
            None => {
                return (StatusCode::BAD_REQUEST, "Invalid or expired state parameter").into_response();
            }
        }
    };

    let server_url = pending.server_url.trim_end_matches('/').to_string();
    let token = params.token.clone();

    // Build an authenticated reqwest client.
    let client = match reqwest::Client::builder()
        .user_agent("wrazz-desktop")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
    };

    // Resolve workspace IDs to add.
    let workspace_ids: Vec<String> = match params.workspaces.as_deref() {
        Some("*") | None => {
            // Fetch all workspaces for this token from the server.
            match fetch_all_workspaces(&client, &server_url, &token).await {
                Ok(ids) => ids,
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, format!("Failed to fetch workspaces: {e}")).into_response();
                }
            }
        }
        Some(ids_str) => ids_str.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
    };

    // For each workspace ID, fetch its name and persist it.
    let mut added_configs: Vec<RemoteWorkspaceConfig> = Vec::new();

    for ws_id in &workspace_ids {
        match fetch_workspace_name(&client, &server_url, &token, ws_id).await {
            Ok(name) => {
                added_configs.push(RemoteWorkspaceConfig {
                    id: ws_id.clone(),
                    name,
                    server_url: server_url.clone(),
                    token: token.clone(),
                });
            }
            Err(e) => {
                tracing::warn!("Failed to fetch workspace {ws_id}: {e}");
            }
        }
    }

    if added_configs.is_empty() {
        return (StatusCode::BAD_GATEWAY, "No workspaces could be resolved from server").into_response();
    }

    // Persist to config and add to registry.
    {
        let mut config = state.shared_config.write().await;
        for cfg in &added_configs {
            config.add(WorkspaceEntry::Remote(cfg.clone()));
        }
        if let Err(e) = config.save(&state.config_path) {
            tracing::error!("Failed to save workspace config: {e}");
        }
    }

    // Add to registry and emit events.
    for cfg in &added_configs {
        let ws = Arc::new(wrazz_backend::RemoteWorkspace::new(cfg.clone()));
        state.registry.add(ws).await;

        // Emit Tauri event so the frontend can refresh its workspace list.
        if let Err(e) = state.app_handle.emit("workspace-connected", &cfg.id) {
            tracing::warn!("Failed to emit workspace-connected event: {e}");
        }
    }

    if let Some(popup) = state.app_handle.get_webview_window("connect-popup") {
        let _ = popup.close();
    }
    (StatusCode::OK, "Connected").into_response()
}

async fn fetch_all_workspaces(
    client: &reqwest::Client,
    server_url: &str,
    token: &str,
) -> Result<Vec<String>, String> {
    let url = format!("{server_url}/api/v1/workspaces");
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }

    let workspaces: Vec<WorkspaceSummaryFromServer> =
        resp.json().await.map_err(|e| e.to_string())?;

    Ok(workspaces.into_iter().map(|w| w.id).collect())
}

async fn fetch_workspace_name(
    client: &reqwest::Client,
    server_url: &str,
    token: &str,
    workspace_id: &str,
) -> Result<String, String> {
    let url = format!("{server_url}/api/v1/workspaces/{workspace_id}");
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }

    let ws: WorkspaceSummaryFromServer = resp.json().await.map_err(|e| e.to_string())?;
    Ok(ws.name)
}
