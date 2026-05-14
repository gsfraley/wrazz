use std::sync::Arc;

use async_trait::async_trait;
use wrazz_core::{Backend, BackendError, BackendResult, Entry, FileContent, FileEntry};

use crate::WorkspaceRegistry;

/// [`Backend`] adapter over a [`WorkspaceRegistry`].
///
/// Bridges the multi-workspace `Backend` interface (which carries an explicit
/// `workspace` parameter on every method) to the registry's single-workspace
/// `Workspace` trait objects. Incoming calls are routed to the matching
/// workspace in the registry; an unknown workspace ID yields
/// [`BackendError::NotFound`].
///
/// This is the primary `Backend` impl used by the `wrazz-backend` standalone
/// binary and will be used by `wrazz-desktop` to expose its local workspace
/// registry over the shared HTTP API.
pub struct RegistryBackend {
    registry: Arc<WorkspaceRegistry>,
}

impl RegistryBackend {
    pub fn new(registry: Arc<WorkspaceRegistry>) -> Self {
        Self { registry }
    }

    async fn ws(&self, workspace: &str) -> BackendResult<Arc<dyn wrazz_core::Workspace>> {
        self.registry
            .get(workspace)
            .await
            .ok_or_else(|| BackendError::NotFound(format!("workspace {workspace}")))
    }
}

#[async_trait]
impl Backend for RegistryBackend {
    async fn list_entries(&self, workspace: &str, path: &str) -> BackendResult<Vec<Entry>> {
        self.ws(workspace).await?.list_entries(path).await
    }

    async fn get_file(&self, workspace: &str, path: &str) -> BackendResult<FileEntry> {
        self.ws(workspace).await?.get_file(path).await
    }

    async fn get_file_content(&self, workspace: &str, path: &str) -> BackendResult<FileContent> {
        self.ws(workspace).await?.get_file_content(path).await
    }

    async fn create_file(
        &self,
        workspace: &str,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        self.ws(workspace).await?.create_file(path, title, tags, content).await
    }

    async fn update_file(
        &self,
        workspace: &str,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        self.ws(workspace).await?.update_file(path, title, tags, content).await
    }

    async fn delete_entry(&self, workspace: &str, path: &str) -> BackendResult<()> {
        self.ws(workspace).await?.delete_entry(path).await
    }

    async fn create_dir(&self, workspace: &str, path: &str) -> BackendResult<()> {
        self.ws(workspace).await?.create_dir(path).await
    }

    async fn move_entry(
        &self,
        ws_from: &str,
        path_from: &str,
        ws_to: &str,
        path_to: &str,
    ) -> BackendResult<()> {
        if ws_from != ws_to {
            return Err(BackendError::Internal(Box::new(std::io::Error::other(
                "cross-workspace moves are not yet supported",
            ))));
        }
        self.ws(ws_from).await?.move_entry(path_from, path_to).await
    }
}
