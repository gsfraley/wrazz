use std::{path::PathBuf, sync::Arc};

use chrono::Duration;
use sqlx::SqlitePool;
use tokio::sync::RwLock;
use wrazz_backend::WorkspaceRegistry;

use crate::routes::oidc::OidcProvider;

/// Shared server state injected into every Axum handler via [`State`].
///
/// `AppState` is cheap to clone — all heavy resources are behind `Arc`.
///
/// [`State`]: axum::extract::State
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    /// Runtime registry of open [`ServerWorkspace`] instances.
    /// Populated lazily on first access per workspace; persists for the
    /// server's lifetime (workspaces are cheap to keep open).
    pub workspace_registry: Arc<WorkspaceRegistry>,
    /// Root data directory (`WRAZZ_DATA_DIR`). Workspace directories live at
    /// `<data_dir>/<user_id>/<workspace_id>/`.
    pub data_dir: Arc<PathBuf>,
    /// Hot-swappable OIDC provider. `None` when OIDC is not configured or
    /// discovery failed.
    pub oidc_provider: Arc<RwLock<Option<Arc<OidcProvider>>>>,
    pub session_duration: Duration,
    pub public_url: Option<String>,
}
