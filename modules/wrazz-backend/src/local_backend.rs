use async_trait::async_trait;
use wrazz_core::{Backend, BackendError, BackendResult, Entry, FileContent, FileEntry};

use crate::store::{Store, StoreError};

impl From<StoreError> for BackendError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::NotFound { path } => BackendError::NotFound(path),
            StoreError::Conflict { path } => BackendError::Conflict(path),
            e => BackendError::Internal(Box::new(e)),
        }
    }
}

/// [`Backend`] implementation that reads and writes files directly on the
/// local filesystem via a [`Store`].
///
/// Holds a single workspace — cross-workspace operations are not supported
/// in local mode. `wrazz-server` uses [`Store`] directly for multi-user
/// deployments and does not go through this wrapper.
pub struct LocalBackend {
    workspace_id: String,
    store: Store,
}

impl LocalBackend {
    pub fn new(workspace_id: impl Into<String>, store: Store) -> Self {
        Self { workspace_id: workspace_id.into(), store }
    }

    fn check_workspace(&self, workspace: &str) -> BackendResult<()> {
        if workspace != self.workspace_id {
            return Err(BackendError::NotFound(format!("workspace {workspace}")));
        }
        Ok(())
    }

    /// Strips the leading `/` from a Backend-convention path to get a Store-relative path.
    fn rel(path: &str) -> &str {
        path.trim_start_matches('/')
    }
}

#[async_trait]
impl Backend for LocalBackend {
    async fn list_entries(&self, workspace: &str, path: &str) -> BackendResult<Vec<Entry>> {
        self.check_workspace(workspace)?;
        self.store.list(Self::rel(path)).await.map_err(Into::into)
    }

    async fn get_file(&self, workspace: &str, path: &str) -> BackendResult<FileEntry> {
        self.check_workspace(workspace)?;
        self.store.load_metadata(Self::rel(path)).await.map_err(Into::into)
    }

    async fn get_file_content(&self, workspace: &str, path: &str) -> BackendResult<FileContent> {
        self.check_workspace(workspace)?;
        self.store.load_content(Self::rel(path)).await.map_err(Into::into)
    }

    async fn create_file(
        &self,
        workspace: &str,
        path: &str,
        title: String,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        self.check_workspace(workspace)?;
        self.store.create(Self::rel(path), title, tags, content).await.map_err(Into::into)
    }

    async fn update_file(
        &self,
        workspace: &str,
        path: &str,
        title: String,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        self.check_workspace(workspace)?;
        self.store.save(Self::rel(path), title, tags, content).await.map_err(Into::into)
    }

    async fn delete_entry(&self, workspace: &str, path: &str) -> BackendResult<()> {
        self.check_workspace(workspace)?;
        self.store.delete_entry(Self::rel(path)).await.map_err(Into::into)
    }

    async fn create_dir(&self, workspace: &str, path: &str) -> BackendResult<()> {
        self.check_workspace(workspace)?;
        self.store.create_dir(Self::rel(path)).await.map_err(Into::into)
    }

    async fn move_entry(
        &self,
        ws_from: &str,
        path_from: &str,
        ws_to: &str,
        path_to: &str,
    ) -> BackendResult<()> {
        self.check_workspace(ws_from)?;
        if ws_from != ws_to {
            return Err(BackendError::Internal(Box::new(std::io::Error::other(
                "cross-workspace moves are not supported in local mode",
            ))));
        }
        self.store
            .rename_entry(Self::rel(path_from), Self::rel(path_to))
            .await
            .map_err(Into::into)
    }
}
