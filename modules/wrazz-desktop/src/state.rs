use std::{path::PathBuf, sync::Arc};
use tokio::sync::RwLock;
use wrazz_backend::WorkspaceRegistry;
use crate::{connect::ConnectState, workspace_config::WorkspaceConfig};

#[derive(Clone)]
pub struct AppState {
    pub api_port: u16,
    pub registry: Arc<WorkspaceRegistry>,
    pub shared_config: Arc<RwLock<WorkspaceConfig>>,
    pub config_path: Arc<PathBuf>,
    pub connect_state: Arc<ConnectState>,
    /// Keeps the dedicated tokio Runtime alive for the duration of the app.
    pub _runtime: Arc<tokio::runtime::Runtime>,
}
