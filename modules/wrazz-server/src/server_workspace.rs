//! Server-side workspace implementation and registry helpers.

use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use uuid::Uuid;
use wrazz_backend::{Store, WorkspaceRegistry};
use wrazz_core::{BackendResult, Entry, FileContent, FileEntry, Workspace};

// --- ServerWorkspace ---

fn rel(path: &str) -> &str {
    path.trim_start_matches('/')
}

/// A workspace owned by a specific user on the server.
///
/// Wraps a [`Store`] rooted at `<data_dir>/<user_id>/<workspace_id>/`.
/// The `user_id` is stored so that handlers can verify ownership without a
/// second database round-trip once the workspace is in the registry.
pub struct ServerWorkspace {
    id: String,
    pub user_id: Uuid,
    name: String,
    store: Arc<Store>,
}

impl ServerWorkspace {
    pub fn new(
        id: impl Into<String>,
        user_id: Uuid,
        name: impl Into<String>,
        store: Arc<Store>,
    ) -> Self {
        Self { id: id.into(), user_id, name: name.into(), store }
    }
}

#[async_trait]
impl Workspace for ServerWorkspace {
    fn id(&self) -> &str { &self.id }
    fn name(&self) -> &str { &self.name }

    async fn list_entries(&self, path: &str) -> BackendResult<Vec<Entry>> {
        self.store.list(rel(path)).await.map_err(Into::into)
    }
    async fn get_file(&self, path: &str) -> BackendResult<FileEntry> {
        self.store.load_metadata(rel(path)).await.map_err(Into::into)
    }
    async fn get_file_content(&self, path: &str) -> BackendResult<FileContent> {
        self.store.load_content(rel(path)).await.map_err(Into::into)
    }
    async fn create_file(
        &self, path: &str, title: Option<String>, tags: Vec<String>, content: String,
    ) -> BackendResult<FileEntry> {
        self.store.create(rel(path), title, tags, content).await.map_err(Into::into)
    }
    async fn update_file(
        &self, path: &str, title: Option<String>, tags: Vec<String>, content: String,
    ) -> BackendResult<FileEntry> {
        self.store.save(rel(path), title, tags, content).await.map_err(Into::into)
    }
    async fn delete_entry(&self, path: &str) -> BackendResult<()> {
        self.store.delete_entry(rel(path)).await.map_err(Into::into)
    }
    async fn create_dir(&self, path: &str) -> BackendResult<()> {
        self.store.create_dir(rel(path)).await.map_err(Into::into)
    }
    async fn move_entry(&self, path_from: &str, path_to: &str) -> BackendResult<()> {
        self.store.rename_entry(rel(path_from), rel(path_to)).await.map_err(Into::into)
    }
    async fn walk_files(&self, path: &str) -> BackendResult<Vec<String>> {
        self.store.walk_files(rel(path)).await.map_err(Into::into)
    }
}

// --- Registry helper ---

/// Returns the `ServerWorkspace` for `(workspace_id, user_id)` from the
/// registry, initialising it on first access.
///
/// Callers are responsible for verifying ownership in the DB before calling
/// this — the registry does not re-check ownership on cache hits.
pub async fn get_or_init(
    registry: &WorkspaceRegistry,
    data_dir: &Path,
    workspace_id: Uuid,
    user_id: Uuid,
    name: &str,
) -> Result<Arc<dyn Workspace>, std::io::Error> {
    let id_str = workspace_id.to_string();

    // Fast path: already in registry.
    if let Some(ws) = registry.get(&id_str).await {
        return Ok(ws);
    }

    // Slow path: open the Store, add to registry.
    let workspace_dir = data_dir
        .join(user_id.to_string())
        .join(&id_str);
    tokio::fs::create_dir_all(&workspace_dir).await?;
    let store = Arc::new(Store::new(workspace_dir));
    let ws = Arc::new(ServerWorkspace::new(&id_str, user_id, name, store));
    registry.add(ws.clone()).await;
    Ok(ws)
}
